# Mastra Input Processor Session Summary

## 1. What an input processor is

In Mastra, an input processor is a component that can inspect and transform the message array before the model runs.

In this project, the processor is implemented in `src/mastra/processors/logging-processor.ts` and registered on the dashboard agent through `inputProcessors` in `src/mastra/agents/dashboard-agent.ts`.

The processor receives `MastraDBMessage[]` and returns a transformed `MastraDBMessage[]`.

Simple shape:

```ts
export class LoggingProcessor implements Processor {
	id = 'logging-processor';

	async processInput({ messages }: ProcessInputArgs): Promise<MastraDBMessage[]> {
		return messages;
	}
}
```

## 2. When the processor runs

The processor currently implements two hooks:

- `processInput`
- `processInputStep`

What they do:

- `processInput` runs once at the start of the request
- `processInputStep` runs before each model step

This means the processor can sanitize the initial input and also ensure the same rules are applied again before later model steps.

Example:

```ts
async processInput({ messages }: ProcessInputArgs): Promise<MastraDBMessage[]> {
	return this.sanitizeMessages(messages, 'processInput');
}

async processInputStep({ messages }: ProcessInputStepArgs): Promise<MastraDBMessage[]> {
	return this.sanitizeMessages(messages, 'processInputStep');
}
```

## 3. What this processor currently does

The current processor has two responsibilities:

1. Log the raw `messages` input it receives.
2. Remove attachment payloads that arrive as text parts.

The stripping logic is based on this pattern:

- if a text part starts with something like `<attachment name=...>`
- that text part is removed from the message

After filtering, the processor rebuilds:

- `content.parts`
- `content.content`

from the remaining text parts.

Current core logic:

```ts
const ATTACHMENT_PREFIX = /^<attachment\b[^>]*>\s*/i;

const sanitizedParts = parts.flatMap((part) => {
	if (part.type !== 'text') {
		return [];
	}

	if (!ATTACHMENT_PREFIX.test(part.text)) {
		return [part];
	}

	return [];
});
```

## 4. Why this processor was needed

The original assumption was that uploaded files would arrive as separate non-text attachment parts or as a file-path note.

Runtime logs showed that this assumption was wrong in the current environment.

Instead, uploaded files were reaching the processor as plain text inside `message.content.parts`.

That meant a processor that only filtered non-text parts would not remove the uploaded file contents.

The earlier idea that was not sufficient looked like this:

```ts
const keptParts = parts.filter((part) => part.type === 'text');
```

That keeps normal text parts, but it does not help when the attachment payload is already embedded inside a text part.

## 5. What the runtime input actually looked like

The important runtime finding was:

- the uploaded CSV appeared as a text part
- the text started with `<attachment name=customers-100.csv>`
- the rest of the same text field contained the full CSV body

So the attachment was already flattened into text before the processor saw it.

Example of the kind of text we observed:

```txt
<attachment name=customers-100.csv>
Index,Customer Id,First Name,...
```

## 6. What the logs proved

The logs showed the following behavior:

- in `processInput`, the uploaded-file message still existed in the incoming `messages`
- after the processor ran, that attachment-derived text part was removed
- in `processInputStep`, the same message had already become empty, with `parts: []` and `content: ''`

This confirms that the processor is successfully stripping the embedded attachment payload before the model step.

Simplified before/after shape:

```ts
// Before sanitization
content: {
	format: 2,
	parts: [{ type: 'text', text: '<attachment name=customers-100.csv> ...csv body...' }]
}

// After sanitization
content: {
	format: 2,
	parts: [],
	content: ''
}
```

## 7. Current behavior of the sanitized message

When a message contains only an attachment-derived text part, the processor transforms it into an effectively empty message:

- `parts: []`
- `content: ''`

This is expected with the current implementation because the processor removes the attachment text and does not insert any replacement text.

## 8. Current limitation

The processor removes the attachment payload, but it does not preserve any useful reference to it.

As a result:

- the model no longer sees the uploaded file contents
- the model does not receive a filename note
- the model does not receive a file path note

So the processor is good for stripping raw attachment text, but not yet sufficient if the agent needs to work with the uploaded file afterward.

## 9. Mismatch discovered in the agent instructions

The dashboard agent instructions currently say that uploaded files are saved to `uploads/` and replaced with a text note containing the file path.

That does not match the runtime behavior observed in this session.

What we actually observed was:

- the uploaded file content arrived as embedded text
- the processor removed that text
- no file path note was present in the processor input

## 10. Current implementation summary

Current repo state relevant to this session:

- `src/mastra/processors/logging-processor.ts` exists and is active
- `src/mastra/agents/dashboard-agent.ts` includes `inputProcessors: [new LoggingProcessor()]`
- the processor logs the raw input messages it receives
- the processor strips text parts that match the attachment marker pattern

Registration example:

```ts
export const dashboardAgent = new Agent({
	// ...
	inputProcessors: [new LoggingProcessor()],
});
```

## 11. Practical next options

The next reasonable implementation options are:

1. Replace stripped attachments with a placeholder such as `[Attachment removed: customers-100.csv]`.
2. Keep only the extracted filename from the attachment header.
3. Save the uploaded content to `uploads/` and replace the message with a file path note.
4. Update the dashboard agent instructions so they match the actual runtime behavior.

## 12. What we implemented after the path-based concept request

After the earlier stripping-only processor work, the next goal was more specific:

- do not let the uploaded file contents stay inside the prompt
- save the uploaded file into the workspace
- replace the attachment payload with a short text note containing the saved path
- make the agent read the file later through workspace tools instead of receiving the full file inline

That concept is the correct direction for this project because the dashboard agent already works inside a local workspace and already has instructions telling it to use workspace tools.

### 12.1 The concept that was requested

The requested concept was:

1. User uploads a file in Studio.
2. The input processor intercepts the message before the model sees it.
3. The processor writes the uploaded file into the workspace.
4. The processor removes the raw attachment payload from the message.
5. The processor inserts a text note such as `uploads/customers-100.csv`.
6. The agent later uses `read_file` from the workspace instead of consuming the raw file contents in the prompt.

This is better than raw attachment injection because it keeps the prompt smaller and makes file access explicit and tool-driven.

### 12.2 What we changed in the codebase

We replaced the temporary logging-only processor registration with a real path-based processor.

The active processor is now:

- `src/mastra/processors/attachment-to-file-path.ts`

The dashboard agent now registers:

```ts
inputProcessors: [new AttachmentToFilePathProcessor(basePath)]
```

That means the processor writes files into the same workspace root already used by the dashboard agent, not into a separate ad hoc folder.

### 12.3 Why the first path-based implementation did not save the CSV

The first implementation followed the conceptual shape correctly, but it assumed the upload would arrive as a Mastra `file` part with a base64 `data:` URL.

That implementation looked for parts like this:

```ts
{ type: 'file', url: 'data:text/csv;base64,...' }
```

and then decoded and saved them.

That was valid according to the installed Mastra code, but it did not match the actual runtime shape you were seeing in Studio.

Your earlier logs had already shown that uploads in this environment could arrive as text that looked like this:

```txt
<attachment name=customers-100.csv>
Index,Customer Id,First Name,...
```

So the first path-based processor missed the upload because it only handled `file` parts and did not yet handle attachment payloads embedded inside `text` parts.

### 12.4 The fix we applied

We updated the processor so it now supports both attachment shapes:

1. Real `file` parts with `data:` URLs.
2. Text parts that begin with `<attachment name=...>` and then contain the file body.

This made the processor robust against the actual Studio behavior observed in this repo.

The processor now checks both cases during message rewriting.

Simple shape of the branching logic:

```ts
for (const part of parts) {
	if (this.isInlineFilePart(part)) {
		// decode base64 data URL and save file
	}

	if (this.isAttachmentTextPart(part)) {
		// extract filename and body from text and save file
	}
}
```

### 12.5 How the final processor works in detail

The final processor class is `AttachmentToFilePathProcessor`.

It implements both:

- `processInput`
- `processInputStep`

Both methods call the same internal rewrite function so the same attachment-to-path behavior is applied consistently.

#### A. Detecting file-part uploads

For true file parts, the processor checks:

```ts
part.type === 'file' && typeof part.url === 'string' && part.url.startsWith('data:')
```

If that matches, it:

1. parses the base64 data URL
2. decodes it into a `Buffer`
3. chooses a safe filename
4. writes the file into `uploads/`
5. removes the raw file part from the message

#### B. Detecting text-based attachment uploads

For text-based uploads, the processor checks whether the text starts with an attachment header.

The regex used is:

```ts
const ATTACHMENT_TEXT_PREFIX = /^<attachment\s+name=(['"]?)([^>'"\r\n]+)\1>\s*/i;
```

If that matches, it:

1. extracts the filename from the header
2. removes the header from the text
3. treats the remaining text as the file body
4. writes that body into `uploads/<filename>`
5. removes the original attachment text part from the message

This is the part that fixed the CSV-not-saved problem you reported.

#### C. Replacing the attachment with a path note

After saving one or more files for a message, the processor appends a normal text part like this:

```ts
{
	type: 'text',
	text: 'File saved to workspace:\nuploads/customers-100.csv\nUse the workspace read_file tool to inspect them.'
}
```

So the model no longer receives the raw CSV body, but it still receives the useful reference telling it where the file is.

#### D. Rebuilding the message content

After rewriting the parts, the processor rebuilds:

- `content.parts`
- `content.content`

from the remaining text parts plus the new path note.

That keeps the message internally consistent after the attachment payload is removed.

### 12.6 Logging the saved path

You also asked to log the path of the saved file.

We added a log line in both save paths:

```ts
console.log(`[AttachmentToFilePathProcessor] saved ${relativePath}`);
```

So when the processor successfully writes a file, the runtime log should show something like:

```txt
[AttachmentToFilePathProcessor] saved uploads/customers-100.csv
```

This gives a direct confirmation that:

- the processor matched the upload shape
- the file was written successfully
- the relative workspace path is known

### 12.7 Where the file is written

The processor is constructed with `basePath` from the workspace setup.

So the saved file path is effectively:

```txt
<workspace base path>/uploads/<filename>
```

In this repo, that means the file is written under the dashboard workspace, not under the project root directly.

Conceptually:

```txt
dashboard-workspace/uploads/customers-100.csv
```

This matches the dashboard agent instructions and the intended workspace layout.

### 12.8 Why this final version is better than the earlier stripping-only processor

The earlier processor removed attachment payloads, but it threw away the useful reference to the uploaded file.

That caused two problems:

- the model no longer saw the file contents
- the model also had no path or filename to work with afterward

The final version fixes that by preserving the important part:

- the file is saved into the workspace
- the model gets a path note instead of raw content
- the agent can read the file later through workspace tools

So the final behavior is not just "strip the attachment".
It is "convert the attachment into a workspace file reference".

### 12.9 Final outcome of this phase

After you gave the path-based concept, the implementation evolved in two steps:

1. First, we implemented the path-based processor for `file` parts with `data:` URLs.
2. Then, after you reported that the CSV still was not appearing in `uploads/`, we updated the processor to also support the text-based `<attachment name=...>` format and added explicit path logging.

So the final implemented behavior is:

1. intercept upload before the model sees it
2. detect either supported attachment shape
3. save the file into `uploads/`
4. log the saved relative path
5. replace the raw attachment payload with a text note containing the saved path
6. let the agent use workspace tools to read the file later on demand

That is the detailed implementation of the concept you asked for.

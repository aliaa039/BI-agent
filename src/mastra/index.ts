import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { dashboardWorkspace } from './workspace';
import { dashboardAgent } from './agents/dashboard-agent';
// import { plannerAgent } from './agents/planner-agent';

export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:./mastra.db',
  }),
  workspace: dashboardWorkspace,
  agents: { dashboardAgent /*, plannerAgent */ },
});

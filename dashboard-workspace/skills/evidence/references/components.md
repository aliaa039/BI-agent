# Evidence Components Reference

Components use HTML-like syntax inside `.md` files. Query results are passed with `{...}`; column names and string literals are passed unquoted.

## Data Components

```markdown
<!-- Inline value in prose -->
Revenue was <Value data={summary} column=total_revenue fmt=usd0 />.

<!-- KPI card -->
<BigValue data={summary} value=total_revenue title="Total Revenue" fmt=usd0 />

<!-- Change indicator -->
<Delta data={comparison} column=revenue_change />

<!-- Full table -->
<DataTable data={sales_by_category} />

<!-- Table rows that link to a templated page -->
<DataTable data={customers} link=customer_link />
```

## Chart Components

All charts require `data`. `x` defaults to first column; `y` defaults to all remaining numeric columns.

```markdown
<BarChart data={sales_by_category} x=category y=sales title="Sales by Category" />

<LineChart data={monthly_revenue} x=month y=revenue series=region />

<AreaChart data={monthly_revenue} x=month y=revenue />

<ScatterPlot data={products} x=price y=margin size=volume />

<Histogram data={orders} x=order_value />

<FunnelChart data={funnel_steps} nameCol=step valueCol=count />

<BubbleChart data={segments} x=revenue y=margin size=count series=segment />

<Heatmap data={activity} x=day y=hour value=count />

<CalendarHeatmap data={daily_sales} date=order_date value=sales />
```

**Multiple y-series**: `y={["revenue", "cost"]}` or use a `series=` column.

**Annotations inside charts:**

```markdown
<LineChart data={sales} x=date y=revenue>
  <ReferenceLine y=50000 label="Target" />
  <ReferenceArea xMin="2024-01-01" xMax="2024-03-31" label="Q1" />
</LineChart>
```

## Input / Filter Components

Every input **must have a `name` prop** — this is how queries reference it via `${inputs.name}`.

```markdown
<Dropdown name=selected_category data={categories} value=category />

<Dropdown name=regions data={region_list} value=region multiple=true />

<DateRange name=date_range />

<Slider name=threshold min=0 max=100 defaultValue=50 />

<TextInput name=search_term />

<ButtonGroup name=period>
  <ButtonGroupItem valueLabel="Monthly" value="month" />
  <ButtonGroupItem valueLabel="Quarterly" value="quarter" />
</ButtonGroup>
```

## Map Components

```markdown
<PointMap data={store_locations} lat=latitude long=longitude />

<AreaMap data={state_sales} geoJsonUrl="/us-states.geojson" areaCol=state valueCol=sales />

<BubbleMap data={cities} lat=lat long=long size=population />

<USMap data={state_data} state=state_code value=revenue />
```

## UI Layout Components

```markdown
<Grid cols=2>
  <BigValue data={kpis} value=revenue />
  <BigValue data={kpis} value=orders />
</Grid>

<Tabs>
  <Tab label="Revenue">
    <LineChart data={monthly} x=month y=revenue />
  </Tab>
  <Tab label="Orders">
    <BarChart data={monthly} x=month y=orders />
  </Tab>
</Tabs>

<Accordion title="Show Details">
  <DataTable data={detail_data} />
</Accordion>

<Alert status="warning">Data refreshes daily at 6am UTC</Alert>

<Note>Excludes returns and refunds.</Note>

<DownloadData data={sales_by_category} />
```

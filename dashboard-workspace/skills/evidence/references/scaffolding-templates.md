# Evidence Quick Scaffolding Templates

## New CSV Source from a File Path

Given path `/home/user/data/sales_2024.csv`:

```bash
# 1. Create source folder and write connection config
mkdir -p sources/sales_data
printf "type: csv\n" > sources/sales_data/connection.yaml

# 2. Copy CSV into the source folder (rename to snake_case if original name has special chars)
cp /home/user/data/sales_2024.csv sources/sales_data/sales_2024.csv

# 3. Extract to Parquet
npm run sources -- --sources sales_data
```

Then query in any page as:
```sql
select * from sales_data.sales_2024
```

---

## Minimal Dashboard Page

````markdown
---
title: Sales Overview
---

# Sales Overview

```sql daily_sales
select
  date_trunc('day', order_date) as day,
  sum(revenue) as revenue,
  count(*) as orders
from sales_data.sales_2024
where order_date >= current_date - interval 30 days
group by 1
order by 1
```

<Grid cols=2>
  <BigValue data={daily_sales} value=revenue title="30-Day Revenue" fmt=usd0 />
  <BigValue data={daily_sales} value=orders title="30-Day Orders" fmt=num0 />
</Grid>

<LineChart data={daily_sales} x=day y=revenue title="Daily Revenue (Last 30 Days)" />
````

---

## Filtered Report Page

````markdown
---
title: Category Report
---

# Category Report

```sql categories
select distinct category from sales_data.sales_2024 order by 1
```

<Dropdown name=selected_category data={categories} value=category defaultValue="All" />

```sql filtered_sales
select category, product, sum(revenue) as revenue
from sales_data.sales_2024
where '${inputs.selected_category}' = 'All'
   or category = '${inputs.selected_category}'
group by 1, 2
order by 3 desc
```

<DataTable data={filtered_sales} />
<BarChart data={filtered_sales} x=product y=revenue series=category />
````

---

## Templated Customer Page

```
pages/
├── customers/
│   ├── index.md        ← lists all customers with links
│   └── [customer].md   ← one page per customer
```

`pages/customers/index.md`:
````markdown
# Customers

```sql customers
select
  customer_name,
  '/customers/' || customer_name as link,
  sum(revenue) as revenue
from sales_data.sales_2024
group by 1
order by 3 desc
```

<DataTable data={customers} link=link />
````

`pages/customers/[customer].md`:
````markdown
# {params.customer}

```sql customer_data
select
  date_trunc('month', order_date) as month,
  sum(revenue) as revenue,
  count(*) as orders
from sales_data.sales_2024
where customer_name = '${params.customer}'
group by 1
order by 1
```

<Grid cols=2>
  <BigValue data={customer_data} value=revenue title="Total Revenue" fmt=usd0 />
  <BigValue data={customer_data} value=orders title="Total Orders" fmt=num0 />
</Grid>

<LineChart data={customer_data} x=month y=revenue title="Monthly Revenue" />
````

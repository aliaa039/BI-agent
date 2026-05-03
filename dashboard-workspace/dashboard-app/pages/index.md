---
title: Customer Exploration
---

# Customer Exploration

This page explores the `customers-100.csv` file loaded from the `customers` source.

```customers_overview
select
	count(*) as total_customers,
	count(distinct Country) as countries,
	count(distinct Company) as companies,
	min(cast("Subscription Date" as date)) as first_subscription,
	max(cast("Subscription Date" as date)) as latest_subscription
from customers."customers-100"
```

<BigValue
	data={customers_overview}
	value=total_customers
	title="Total Customers"
/>

<BigValue
	data={customers_overview}
	value=countries
	title="Countries"
/>

<BigValue
	data={customers_overview}
	value=companies
	title="Companies"
/>

## Subscription Trend

```subscriptions_by_month
select
	date_trunc('month', cast("Subscription Date" as date)) as subscription_month,
	count(*) as customers
from customers."customers-100"
group by 1
order by 1
```

<BarChart
	data={subscriptions_by_month}
	x=subscription_month
	y=customers
	xFmt="mmm yyyy"
	xAxisTitle="Month"
	yAxisTitle="Customers"
/>

## Top Countries

```customers_by_country
select
	Country,
	count(*) as customers
from customers."customers-100"
group by 1
order by customers desc, Country
limit 15
```

<BarChart
	data={customers_by_country}
	x=Country
	y=customers
	swapXY=true
	yAxisTitle="Customers"
/>

## Top Cities

```customers_by_city
select
	City,
	Country,
	count(*) as customers
from customers."customers-100"
group by 1, 2
order by customers desc, City
limit 15
```

<DataTable data={customers_by_city}>
	<Column id=City />
	<Column id=Country />
	<Column id=customers title="Customer Count" />
</DataTable>

## Recent Subscribers

```recent_customers
select
	cast("Subscription Date" as date) as subscription_date,
	"First Name" as first_name,
	"Last Name" as last_name,
	Company,
	Country,
	Email
from customers."customers-100"
order by subscription_date desc
limit 20
```

<DataTable data={recent_customers}>
	<Column id=subscription_date title="Subscription Date" />
	<Column id=first_name title="First Name" />
	<Column id=last_name title="Last Name" />
	<Column id=Company />
	<Column id=Country />
	<Column id=Email />
</DataTable>

## Full Dataset Sample

```customer_sample
select
	"Customer Id" as customer_id,
	"First Name" as first_name,
	"Last Name" as last_name,
	Company,
	City,
	Country,
	Email,
	cast("Subscription Date" as date) as subscription_date
from customers."customers-100"
order by subscription_date desc
limit 50
```

<DataTable data={customer_sample} />

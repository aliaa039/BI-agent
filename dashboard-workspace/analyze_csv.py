import pandas as pd

file_path = './uploads/customers-100.csv'
df = pd.read_csv(file_path)

print('Shape:', df.shape)
print('\nColumns:', list(df.columns))
print('\nData types:')
print(df.dtypes)
print('\nFirst 5 rows:')
print(df.head())
print('\nMissing values per column:')
print(df.isna().sum())
print('\nDescriptive statistics (all columns):')
print(df.describe(include='all', datetime_is_numeric=True))

if 'Country' in df.columns:
    print('\nTop 10 countries:')
    print(df['Country'].value_counts().head(10))

if 'Subscription Date' in df.columns:
    dates = pd.to_datetime(df['Subscription Date'], errors='coerce')
    print('\nSubscription date range:')
    print('Min:', dates.min())
    print('Max:', dates.max())

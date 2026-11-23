# BoardLite

BoardLite is a local dashboard for one person. Open CSV or Excel files in the browser, relate the tables, and build filters, tables, KPI cards, and bar and line charts. The files stay on the machine. There is no account and no server.

## Run it

```bash
git clone https://github.com/majidrajpar/boardlite.git
cd boardlite
npm install
npm run dev
```

Open the URL Vite prints. `npm test` runs the fixture suite. `npm run build` typechecks and writes `dist/`.

Sample files live in `testdata/`. `testdata/MANIFEST.json` records what each file is expected to do. `testdata/clean/sales_small.csv` is a small happy path. The `dirty/` and `boundary/` folders hold messy and size-limit cases.

## What you can do

- Open or drop more than one `.csv` or `.xlsx` file. Each file becomes a table. Only the first worksheet of a workbook is read.
- Add a relationship from a column on one table to a column on another. A tile can group by a column on the related table. The link is one hop, from the tile's table to the table it points at. If a key matches more than one row, the first row is used.
- Save a measure as `count`, `sum`, `avg`, `min`, or `max` of one column, and use it on a tile.
- Filter the whole page, or filter a single tile. Both filters apply together. A page filter that names a column the tile does not have is skipped for that tile.
- Paste a URL on a table and choose Reload URLs. The host must allow this page to fetch the file. The URL is saved with the report, so do not paste an address that contains an access key.
- Export the report as JSON, or import one. The file holds the layout, not the rows.
- Copy a read-only link. The link holds the report definition in the URL hash, not the data. The reader opens the same files or uses the same URLs. Save a copy stores that report in the browser.

The report is kept in this browser. Opening a shared link does not replace that saved report until you choose Save a copy.

## Limits

- Up to 50,000 data rows and 100 columns per file. A larger file is refused.
- A column is a number only when every value is an optional `$`, `€`, `£`, or `¥`, an optional minus, and digits with at most one decimal point. Thousands separators, European decimal commas, percents, and accounting parentheses stay text.
- A column is a date only when every value is `YYYY-MM-DD` or an ISO datetime. Real Excel date cells are read as calendar dates. Other date formats stay text.
- A column is a boolean only when every value is `true` or `false`, in any letter case.
- Empty cells are null. The words `N/A`, `null`, and `#N/A` stay text.
- There is no formula language, no accounts, and no hosted sharing.

## Author

**Majid Mumtaz** (ACCA, CIA, ACA)

Director of Internal Audit & Risk Advisory

* Portfolio: [majidrajpar.github.io/portfolio_my](https://majidrajpar.github.io/portfolio_my/)
* LinkedIn: [majid-m-4b097118](https://www.linkedin.com/in/majid-m-4b097118/)
* Email: [majidrajpar@gmail.com](mailto:majidrajpar@gmail.com)

## License

BoardLite is released under the MIT License. See [LICENSE](LICENSE).

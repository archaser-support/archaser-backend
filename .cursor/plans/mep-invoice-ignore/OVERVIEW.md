# Mark invoice as ignored for MEP calculation

Credit users can toggle **ignored for MEP** on unpaid invoices on the customer invoice grid. `overdue_block` skips those rows; AR and capacity gap still include them. After toggle, live capacity gap (customer or shell pool) refreshes and as-of rewrite is enqueued. The grid module is renamed to `CustomerInvoiceGrid`.

**PRD:** `.cursor/plans/mep-invoice-ignore.prd.md`

Vertical slices live under `issues/`.

# View Portfolio Dashboard permission

Split Portfolio Health access onto `view_portfolio_dashboard` while Credit Dashboard keeps `view_credit_dashboard`. System_Administrator gets the new key by default. Accounts can set **Hide Portfolio Health** (`hide_portfolio_health`) under Products (Credit Insurance on only) to fully remove the Portfolio Health surface (nav, Roles key, URL, API) without wiping role grants.

**PRD:** `.cursor/plans/view-portfolio-dashboard-permission.prd.md`

Vertical slices live under `issues/`.

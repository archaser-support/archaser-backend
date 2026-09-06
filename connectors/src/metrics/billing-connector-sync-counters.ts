import { Counter, Histogram, type Registry } from "prom-client";

/**
 * Same metric names/labels as API `createArchaserBusinessMetrics` so Grafana
 * can `sum(...{instance="Staging"})` across api / connectors / worker scrapes.
 */
export function registerBillingConnectorSyncCounters(register: Registry) {
    const billingConnectorSyncTotal = new Counter({
        name: "archaser_billing_connector_sync_total",
        help: "Total billing connector sync runs",
        labelNames: ["provider", "status", "sync_mode", "trigger"],
        registers: [register],
    });

    const billingConnectorSyncDuration = new Histogram({
        name: "archaser_billing_connector_sync_duration_seconds",
        help: "Billing connector sync duration in seconds",
        labelNames: ["provider", "sync_mode"],
        registers: [register],
    });

    const billingConnectorErrorsTotal = new Counter({
        name: "archaser_billing_connector_errors_total",
        help: "Billing connector errors by type",
        labelNames: ["provider", "error_type", "sync_mode"],
        registers: [register],
    });

    const billingConnectorRecordsProcessed = new Counter({
        name: "archaser_billing_connector_records_processed_total",
        help: "Billing connector records processed",
        labelNames: ["provider", "entity_type", "result"],
        registers: [register],
    });

    return {
        billingConnectorSyncTotal,
        billingConnectorSyncDuration,
        billingConnectorErrorsTotal,
        billingConnectorRecordsProcessed,
    };
}

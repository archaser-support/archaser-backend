export type ReportRelationship = {
    from: string;
    to: string;
    fromField: string;
    toField: string;
    type: "one-to-many" | "many-to-one" | "one-to-one";
};
export declare const REPORT_RELATIONSHIPS: ReportRelationship[];

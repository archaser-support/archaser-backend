import { JwtPayload } from "../auth/auth.service";
import { CustomersService } from "./customers.service";
export declare class CustomersLeafController {
    private readonly customers;
    constructor(customers: CustomersService);
    search(user: JwtPayload, q?: string, excludeId?: string): Promise<{
        items: {
            id: number;
            customer_number: string | null;
            type: import(".prisma/client").$Enums.client_type;
            name: string;
        }[];
    }>;
    aggregatedData(user: JwtPayload, customerId: number): Promise<{
        customerId: number;
        childCount: number;
        totalDueAmount: number;
        totalOverdueAmount: number;
        dueInvoiceCount: number;
        overdueInvoiceCount: number;
    }>;
    validateBusinessUnitAccess(user: JwtPayload, body: {
        customerNumbers?: Array<string | number>;
    }): Promise<{
        items: {
            customerNumber: string;
            hasAccess: boolean;
            businessUnitId: number | null;
            businessUnitExternalId: string | null;
        }[];
    }>;
}

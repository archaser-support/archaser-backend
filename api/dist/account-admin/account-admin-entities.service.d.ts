import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare const ACCOUNT_ADMIN_ENTITY_TYPES: readonly ["accounts", "users", "business-units", "bank-accounts", "customer-banks", "business-unit-banks"];
export type AccountAdminEntityType = (typeof ACCOUNT_ADMIN_ENTITY_TYPES)[number];
export type AccountAdminListQuery = {
    page?: string;
    limit?: string;
    search?: string;
    query?: string;
    sortField?: string;
    sortDirection?: string;
    include?: string;
};
export declare class AccountAdminEntitiesService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private delegate;
    parseId(entityType: AccountAdminEntityType, raw: string): number | string;
    private scope;
    list(entityType: AccountAdminEntityType, user: JwtPayload, query: AccountAdminListQuery): Promise<({
        Parent: {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            created_by: string | null;
            modified_by: string | null;
            parent_id: number | null;
            external_id: string | null;
            is_primary: boolean;
        } | null;
        User_BusinessUnit_created_byToUser: {
            email: string;
            name: string | null;
            id: string;
        } | null;
        User_BusinessUnit_modified_byToUser: {
            email: string;
            name: string | null;
            id: string;
        } | null;
    } & {
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.record_status;
        created_by: string | null;
        modified_by: string | null;
        parent_id: number | null;
        external_id: string | null;
        is_primary: boolean;
    })[] | {
        data: ({
            Parent: {
                account_id: number;
                name: string;
                id: number;
                created_at: Date;
                modified_at: Date;
                status: import(".prisma/client").$Enums.record_status;
                created_by: string | null;
                modified_by: string | null;
                parent_id: number | null;
                external_id: string | null;
                is_primary: boolean;
            } | null;
            User_BusinessUnit_created_byToUser: {
                email: string;
                name: string | null;
                id: string;
            } | null;
            User_BusinessUnit_modified_byToUser: {
                email: string;
                name: string | null;
                id: string;
            } | null;
        } & {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            created_by: string | null;
            modified_by: string | null;
            parent_id: number | null;
            external_id: string | null;
            is_primary: boolean;
        })[];
        total: number;
    } | {
        data: ({
            Country: {
                name: string;
                id: number;
                created_at: Date | null;
                modified_at: Date;
                currency: string | null;
                iso3: string | null;
                numeric_code: string | null;
                iso2: string | null;
                phonecode: string | null;
                capital: string | null;
                currency_name: string | null;
                currency_symbol: string | null;
                tld: string | null;
                native: string | null;
                region: string | null;
                region_id: number | null;
                subregion: string | null;
                subregion_id: number | null;
                nationality: string | null;
                translations: string | null;
                latitude: import("@prisma/client/runtime/library").Decimal | null;
                longitude: import("@prisma/client/runtime/library").Decimal | null;
                emoji: string | null;
                emojiU: string | null;
                flag: number;
                wikiDataId: string | null;
            } | null;
            State: {
                type: string | null;
                name: string;
                id: number;
                created_at: Date | null;
                modified_at: Date;
                country_id: number;
                parent_id: number | null;
                iso2: string | null;
                latitude: import("@prisma/client/runtime/library").Decimal | null;
                longitude: import("@prisma/client/runtime/library").Decimal | null;
                flag: number;
                wikiDataId: string | null;
                country_code: string;
                fips_code: string | null;
                level: number | null;
            } | null;
        } & {
            account_id: number;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: boolean;
            created_by: string | null;
            modified_by: string | null;
            address_line1: string | null;
            city: string | null;
            postal_code: string | null;
            address_line2: string | null;
            country_id: number | null;
            state_id: number | null;
            beneficiary_name: string | null;
            bank_name: string | null;
            branch_number: string | null;
            branch_name: string | null;
            swift: string | null;
            iban: string | null;
            account_number: string | null;
            comments: string | null;
            primary: boolean;
        })[];
        total: number;
    } | {
        data: any;
        totalRecords: any;
        page: number;
        limit: number;
    } | {
        users: any;
        total: any;
        page: number;
        limit: number;
    } | {
        [x: string]: any;
        totalRecords: any;
        page: number;
        limit: number;
    }>;
    private businessUnitListInclude;
    private businessUnitOrderBy;
    private listBusinessUnitsDropdown;
    private sortBusinessUnitsHierarchically;
    listAccountBusinessUnits(user: JwtPayload, accountId: number, query?: AccountAdminListQuery): Promise<({
        Parent: {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            created_by: string | null;
            modified_by: string | null;
            parent_id: number | null;
            external_id: string | null;
            is_primary: boolean;
        } | null;
        User_BusinessUnit_created_byToUser: {
            email: string;
            name: string | null;
            id: string;
        } | null;
        User_BusinessUnit_modified_byToUser: {
            email: string;
            name: string | null;
            id: string;
        } | null;
    } & {
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.record_status;
        created_by: string | null;
        modified_by: string | null;
        parent_id: number | null;
        external_id: string | null;
        is_primary: boolean;
    })[] | {
        data: ({
            Parent: {
                account_id: number;
                name: string;
                id: number;
                created_at: Date;
                modified_at: Date;
                status: import(".prisma/client").$Enums.record_status;
                created_by: string | null;
                modified_by: string | null;
                parent_id: number | null;
                external_id: string | null;
                is_primary: boolean;
            } | null;
            User_BusinessUnit_created_byToUser: {
                email: string;
                name: string | null;
                id: string;
            } | null;
            User_BusinessUnit_modified_byToUser: {
                email: string;
                name: string | null;
                id: string;
            } | null;
        } & {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            created_by: string | null;
            modified_by: string | null;
            parent_id: number | null;
            external_id: string | null;
            is_primary: boolean;
        })[];
        total: number;
    }>;
    private bankAccountListInclude;
    private bankAccountOrderBy;
    private assertAccountAccess;
    listAccountBankAccounts(user: JwtPayload, accountId: number, query?: AccountAdminListQuery): Promise<{
        data: ({
            Country: {
                name: string;
                id: number;
                created_at: Date | null;
                modified_at: Date;
                currency: string | null;
                iso3: string | null;
                numeric_code: string | null;
                iso2: string | null;
                phonecode: string | null;
                capital: string | null;
                currency_name: string | null;
                currency_symbol: string | null;
                tld: string | null;
                native: string | null;
                region: string | null;
                region_id: number | null;
                subregion: string | null;
                subregion_id: number | null;
                nationality: string | null;
                translations: string | null;
                latitude: import("@prisma/client/runtime/library").Decimal | null;
                longitude: import("@prisma/client/runtime/library").Decimal | null;
                emoji: string | null;
                emojiU: string | null;
                flag: number;
                wikiDataId: string | null;
            } | null;
            State: {
                type: string | null;
                name: string;
                id: number;
                created_at: Date | null;
                modified_at: Date;
                country_id: number;
                parent_id: number | null;
                iso2: string | null;
                latitude: import("@prisma/client/runtime/library").Decimal | null;
                longitude: import("@prisma/client/runtime/library").Decimal | null;
                flag: number;
                wikiDataId: string | null;
                country_code: string;
                fips_code: string | null;
                level: number | null;
            } | null;
        } & {
            account_id: number;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: boolean;
            created_by: string | null;
            modified_by: string | null;
            address_line1: string | null;
            city: string | null;
            postal_code: string | null;
            address_line2: string | null;
            country_id: number | null;
            state_id: number | null;
            beneficiary_name: string | null;
            bank_name: string | null;
            branch_number: string | null;
            branch_name: string | null;
            swift: string | null;
            iban: string | null;
            account_number: string | null;
            comments: string | null;
            primary: boolean;
        })[];
        total: number;
    }>;
    createAccountBankAccount(user: JwtPayload, accountId: number, body: Record<string, unknown>): Promise<{
        Country: {
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date;
            currency: string | null;
            iso3: string | null;
            numeric_code: string | null;
            iso2: string | null;
            phonecode: string | null;
            capital: string | null;
            currency_name: string | null;
            currency_symbol: string | null;
            tld: string | null;
            native: string | null;
            region: string | null;
            region_id: number | null;
            subregion: string | null;
            subregion_id: number | null;
            nationality: string | null;
            translations: string | null;
            latitude: import("@prisma/client/runtime/library").Decimal | null;
            longitude: import("@prisma/client/runtime/library").Decimal | null;
            emoji: string | null;
            emojiU: string | null;
            flag: number;
            wikiDataId: string | null;
        } | null;
        State: {
            type: string | null;
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date;
            country_id: number;
            parent_id: number | null;
            iso2: string | null;
            latitude: import("@prisma/client/runtime/library").Decimal | null;
            longitude: import("@prisma/client/runtime/library").Decimal | null;
            flag: number;
            wikiDataId: string | null;
            country_code: string;
            fips_code: string | null;
            level: number | null;
        } | null;
    } & {
        account_id: number;
        id: number;
        created_at: Date;
        modified_at: Date;
        status: boolean;
        created_by: string | null;
        modified_by: string | null;
        address_line1: string | null;
        city: string | null;
        postal_code: string | null;
        address_line2: string | null;
        country_id: number | null;
        state_id: number | null;
        beneficiary_name: string | null;
        bank_name: string | null;
        branch_number: string | null;
        branch_name: string | null;
        swift: string | null;
        iban: string | null;
        account_number: string | null;
        comments: string | null;
        primary: boolean;
    }>;
    updateAccountBankAccount(user: JwtPayload, accountId: number, id: number, body: Record<string, unknown>): Promise<{
        Country: {
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date;
            currency: string | null;
            iso3: string | null;
            numeric_code: string | null;
            iso2: string | null;
            phonecode: string | null;
            capital: string | null;
            currency_name: string | null;
            currency_symbol: string | null;
            tld: string | null;
            native: string | null;
            region: string | null;
            region_id: number | null;
            subregion: string | null;
            subregion_id: number | null;
            nationality: string | null;
            translations: string | null;
            latitude: import("@prisma/client/runtime/library").Decimal | null;
            longitude: import("@prisma/client/runtime/library").Decimal | null;
            emoji: string | null;
            emojiU: string | null;
            flag: number;
            wikiDataId: string | null;
        } | null;
        State: {
            type: string | null;
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date;
            country_id: number;
            parent_id: number | null;
            iso2: string | null;
            latitude: import("@prisma/client/runtime/library").Decimal | null;
            longitude: import("@prisma/client/runtime/library").Decimal | null;
            flag: number;
            wikiDataId: string | null;
            country_code: string;
            fips_code: string | null;
            level: number | null;
        } | null;
    } & {
        account_id: number;
        id: number;
        created_at: Date;
        modified_at: Date;
        status: boolean;
        created_by: string | null;
        modified_by: string | null;
        address_line1: string | null;
        city: string | null;
        postal_code: string | null;
        address_line2: string | null;
        country_id: number | null;
        state_id: number | null;
        beneficiary_name: string | null;
        bank_name: string | null;
        branch_number: string | null;
        branch_name: string | null;
        swift: string | null;
        iban: string | null;
        account_number: string | null;
        comments: string | null;
        primary: boolean;
    }>;
    deleteAccountBankAccount(user: JwtPayload, accountId: number, id: number): Promise<{
        success: boolean;
    }>;
    createBusinessUnit(user: JwtPayload, body: Record<string, unknown>): Promise<{
        Parent: {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            created_by: string | null;
            modified_by: string | null;
            parent_id: number | null;
            external_id: string | null;
            is_primary: boolean;
        } | null;
        User_BusinessUnit_created_byToUser: {
            email: string;
            name: string | null;
            id: string;
        } | null;
        User_BusinessUnit_modified_byToUser: {
            email: string;
            name: string | null;
            id: string;
        } | null;
    } & {
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.record_status;
        created_by: string | null;
        modified_by: string | null;
        parent_id: number | null;
        external_id: string | null;
        is_primary: boolean;
    }>;
    updateBusinessUnitStatus(user: JwtPayload, id: number, status: "Active" | "Inactive"): Promise<{
        Parent: {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            created_by: string | null;
            modified_by: string | null;
            parent_id: number | null;
            external_id: string | null;
            is_primary: boolean;
        } | null;
        User_BusinessUnit_created_byToUser: {
            email: string;
            name: string | null;
            id: string;
        } | null;
        User_BusinessUnit_modified_byToUser: {
            email: string;
            name: string | null;
            id: string;
        } | null;
    } & {
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.record_status;
        created_by: string | null;
        modified_by: string | null;
        parent_id: number | null;
        external_id: string | null;
        is_primary: boolean;
    }>;
    deleteBusinessUnit(user: JwtPayload, id: number, reassignToBusinessUnitId?: number | null): Promise<{
        success: boolean;
    }>;
    getById(entityType: AccountAdminEntityType, user: JwtPayload, id: number | string): Promise<any>;
    update(entityType: AccountAdminEntityType, user: JwtPayload, id: number | string, body: Record<string, unknown>): Promise<any>;
    listCollectionAgents(user: JwtPayload): Promise<{
        name: string;
        businessUnitName: string | null;
        username: string;
        email: string;
        role: import(".prisma/client").$Enums.user_role | null;
        id: string;
        status: import(".prisma/client").$Enums.record_status;
        first_name: string | null;
        last_name: string | null;
        business_unit_id: number | null;
        BusinessUnit: {
            name: string;
            id: number;
        } | null;
    }[]>;
}

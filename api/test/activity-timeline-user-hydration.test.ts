import { CustomersService } from "../src/customers/customers.service";
import type { AccessScopeService } from "../src/auth/access-scope.service";
import type { DatabaseService } from "../src/database/database.service";
import type { JwtPayload } from "../src/auth/auth.service";

/**
 * The timeline renders `Activity.title` + `title_params` and `Activity.content`
 * verbatim, and both reference users by id: `{{user:<uuid>}}` inside content and
 * `userId`/`assigneeId` in the params. Nothing downstream can read the User
 * table, so `listActivities` has to hand back display names. Fixtures below are
 * trimmed copies of real rows.
 */
const ACCOUNT_ID = 42;
const CUSTOMER_ID = 1579;

const ASSIGNER = "3bfd1335-7389-4289-a307-6ff5e925eb4b";
const ASSIGNEE = "5e2d28fb-4aa0-41ac-9bd7-fe8872ba1264";
const DELETED = "41a9ec57-759c-419c-892d-e66f80d48934";
const SYSTEM_SENTINEL = "11111111-1111-1111-1111-000000010117";

const user = { sub: "user-1" } as unknown as JwtPayload;

const USERS = [
    { id: ASSIGNER, name: "מרק צוקרברג", first_name: null, last_name: null },
    { id: ASSIGNEE, name: null, first_name: "צופית", last_name: "גרינברג" },
    {
        id: SYSTEM_SENTINEL,
        name: "System User",
        first_name: null,
        last_name: null,
    },
];

function buildService(activityRows: unknown[]) {
    const findManyUsers = jest.fn(
        async ({ where }: { where: { id: { in: string[] } } }) =>
            USERS.filter((u) => where.id.in.includes(u.id))
    );

    const db = {
        customer: {
            findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }),
        },
        activity: {
            findMany: jest.fn().mockResolvedValue(activityRows),
        },
        user: { findMany: findManyUsers },
    } as unknown as DatabaseService;

    const accessScope = {
        resolveUserInfo: jest
            .fn()
            .mockResolvedValue({ accountId: ACCOUNT_ID, role: "Admin" }),
        getEffectiveAccountId: jest.fn().mockReturnValue(ACCOUNT_ID),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
    } as unknown as AccessScopeService;

    return {
        service: new CustomersService(db, accessScope),
        findManyUsers,
    };
}

async function hydrate(rows: unknown[]) {
    const { service, findManyUsers } = buildService(rows);
    const result = (await service.listActivities(user, CUSTOMER_ID, {})) as {
        activities: Array<{
            content?: string | null;
            title_params?: Record<string, unknown>;
        }>;
    };
    return { activities: result.activities, findManyUsers };
}

describe("activity timeline user hydration", () => {
    it("renders dispute assignment actors as names instead of ids", async () => {
        const { activities } = await hydrate([
            {
                id: 7120n,
                title: "{{disputes.fields.assigned}}",
                title_params: {
                    userId: ASSIGNER,
                    disputeId: "726",
                    assigneeId: ASSIGNEE,
                },
                content: null,
                created_by: ASSIGNER,
            },
        ]);

        expect(activities[0].title_params).toMatchObject({
            disputeId: "726",
            userId: "מרק צוקרברג",
            userName: "מרק צוקרברג",
            // Falls back to first + last name when `name` is unset.
            assigneeId: "צופית גרינברג",
            assigneeName: "צופית גרינברג",
        });
    });

    it("replaces {{user:<uuid>}} in content with the display name", async () => {
        const { activities } = await hydrate([
            {
                id: 6982n,
                title: "{{activities.fields.activity_general_call}}",
                title_params: { userId: ASSIGNER, userName: "מרק צוקרברג" },
                content:
                    '<span class="activity-label-primary">{{activities.fields.agent}}:</span> ' +
                    `<span class="activity-value">{{user:${ASSIGNER}}}</span>`,
                created_by: ASSIGNER,
            },
        ]);

        expect(activities[0].content).toContain(
            '<span class="activity-value">מרק צוקרברג</span>'
        );
        expect(activities[0].content).not.toContain("{{user:");
    });

    it("keeps legacy tokens that already hold a display name", async () => {
        const { activities } = await hydrate([
            {
                id: 6965n,
                title: "{{disputes.fields.assigned}}",
                title_params: null,
                content:
                    '<span class="activity-value">{{user:מירית שם טוב}}</span>',
                created_by: null,
            },
        ]);

        expect(activities[0].content).toContain(
            '<span class="activity-value">מירית שם טוב</span>'
        );
    });

    it("maps non-user actors to keys the client translates", async () => {
        const { activities } = await hydrate([
            {
                id: 6788n,
                title: "{{disputes.fields.filed_portal_title}}",
                title_params: { userId: "portal_user" },
                content: null,
                created_by: null,
            },
            {
                id: 5835n,
                title: "{{activities.fields.category_change}}",
                title_params: { userId: "system" },
                content: null,
                created_by: null,
            },
        ]);

        expect(activities[0].title_params?.userId).toBe(
            "{{users.values.portal_user}}"
        );
        expect(activities[1].title_params?.userId).toBe(
            "{{activities.values.system}}"
        );
    });

    it("translates the sentinel account standing in for the system actor", async () => {
        const { activities } = await hydrate([
            {
                id: 5671n,
                title: "{{activities.fields.category_change}}",
                title_params: { oldCategory: "customers.values.category_agent" },
                content: null,
                created_by: SYSTEM_SENTINEL,
            },
        ]);

        // No actor param at all, so the row's author fills the dangling "by".
        expect(activities[0].title_params?.userId).toBe(
            "{{activities.values.system}}"
        );
    });

    it("prefers the recorded name over 'unknown' for a deleted user", async () => {
        const { activities } = await hydrate([
            {
                id: 6964n,
                title: "{{disputes.fields.assigned}}",
                title_params: {
                    userId: DELETED,
                    userName: "אלי לוגאנו",
                    assigneeId: DELETED,
                },
                content: null,
                created_by: null,
            },
        ]);

        expect(activities[0].title_params?.userId).toBe("אלי לוגאנו");
        expect(activities[0].title_params?.assigneeId).toBe(
            "{{users.values.unknown_user}}"
        );
    });

    it("looks every referenced user up in a single query", async () => {
        const rows = Array.from({ length: 10 }, (_, i) => ({
            id: BigInt(i),
            title: "{{disputes.fields.assigned}}",
            title_params: { userId: ASSIGNER, assigneeId: ASSIGNEE },
            content: `<span>{{user:${DELETED}}}</span>`,
            created_by: ASSIGNER,
        }));

        const { findManyUsers } = await hydrate(rows);

        expect(findManyUsers).toHaveBeenCalledTimes(1);
        expect(findManyUsers.mock.calls[0][0].where.id.in.sort()).toEqual(
            [ASSIGNER, ASSIGNEE, DELETED].sort()
        );
    });

    it("leaves uuids that are not user references alone", async () => {
        const magicLink =
            "https://lawfirm.archaser.com/he/portal/89d277e7-8e51-442f-a42c-e082bd1fa6fd";
        const { activities } = await hydrate([
            {
                id: 5649n,
                title: "{{activities.fields.activity_automated_step_sent}}",
                title_params: null,
                content: `<a href="${magicLink}">link</a>`,
                created_by: null,
            },
        ]);

        expect(activities[0].content).toContain(magicLink);
    });
});

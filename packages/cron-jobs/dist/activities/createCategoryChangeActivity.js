"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCategoryChangeActivity = createCategoryChangeActivity;
const getSystemUserId_1 = require("../users/getSystemUserId");
function categoryTranslationKey(category) {
    return `customers.values.category_${category.toLowerCase().replace(/[_\s]/g, "_")}`;
}
/**
 * Slim port of ActivityService.createCategoryChangeActivity for cron category moves.
 */
async function createCategoryChangeActivity(prisma, params) {
    const { customerId, collectionId, accountId, currentCategory, nextCategory, userId: explicitUserId, } = params;
    const systemUserId = explicitUserId ?? (await (0, getSystemUserId_1.getSystemUserId)(prisma, accountId));
    if (!systemUserId) {
        return;
    }
    const nextCategoryKey = categoryTranslationKey(nextCategory);
    let title;
    let titleParams;
    if (!currentCategory) {
        title = "{{activities.fields.category_change_to}}";
        titleParams = { newCategory: nextCategoryKey };
    }
    else {
        title = "{{activities.fields.category_change}}";
        titleParams = {
            oldCategory: categoryTranslationKey(currentCategory),
            newCategory: nextCategoryKey,
        };
    }
    const now = new Date();
    await prisma.activity.create({
        data: {
            customer_id: customerId,
            account_id: accountId,
            collection_period_id: collectionId,
            type: "Internal",
            title,
            title_params: titleParams,
            content: "",
            schedule_time: now,
            actual_delivery_time: now,
            status: "COMPLETED",
            system_generated: true,
            created_by: systemUserId,
            modified_by: systemUserId,
        },
    });
}

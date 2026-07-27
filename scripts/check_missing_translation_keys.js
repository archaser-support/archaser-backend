#!/usr/bin/env node

// List of keys from the user
const keysInDatabase = [
    "activity.log_activity.comment",
    "activity.log_activity.dispute_id",
    "activity.log_activity.dispute_status",
    "activity.log_activity.dispute_resolution",
    "activity.log_activity.agent_name",
    "activity.log_activity.dispute_reason",
    "activity.log_activity.dispute_invoices",
    "activity.log_activity.contact",
    "dashboard.categories.automated",
    "dispute.dispute_status.Under_Review",
    "dashboard.categories.Agent",
    "activity.log_activity.call_outcome",
    "dispute.dispute_status.Resolved",
    "activity.log_activity.call_direction",
    "currentCategory",
    "nextCategory",
    "dispute.dispute_status.Accepted_Settled_partly",
    "activity.log_activity.outgoing_call",
    "activity.log_activity.timezone",
    "dispute.dispute_status.New",
    "activity.log_activity.duration",
    "activity.log_activity.promise_to_pay_due_date",
    "dispute.dispute_status.Admin_Fixed_Balance_Unchanged",
    "activity.log_activity.seconds",
    "dashboard.categories.dispute",
    "dispute.dispute_status.Accepted_Settled_in_full",
    "activity.log_activity.dispute_contact",
    "activity.log_activity.outcomes.general",
    "activity.log_activity.follow_up_time",
    "activity.log_activity.outcomes.schedule_follow_up",
    "activity.log_activity.category_change_new_category",
    "activity.log_activity.category_change_old_category",
    "activity.log_activity.incoming_call",
    "dispute.dispute_status.Denied",
    "user_comment",
    "dashboard.categories.promiseToPay",
    "activity.log_activity.outcomes.no_answer",
    "activity.log_activity.minutes",
    "dispute.dispute_status.Cancelled",
    "activity.outcomes.generic_comment",
    "activity.log_activity.outcomes.open_dispute",
    "dispute.dispute_status.Accepted",
    "activity.log_activity.outcomes.bad_number",
    "activity.log_activity.event",
    "activity.log_activity.outcomes.promise_to_pay",
    "disputes.dispute_details.dispute_comment",
    "disputes.dispute_details.invoices",
    "disputes.dispute_details.dispute_reason",
    "activity.log_activity.outcomes.add_new_contact",
    "activity.log_activity.promise_to_pay",
];

// Load the activities.json file
const fs = require('fs');
const activities = JSON.parse(fs.readFileSync('locales/en/activities.json', 'utf8'));

// Flatten the activities object to check all paths
const flattenKeys = (obj, prefix = 'activities') => {
    const keys = [];
    for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            keys.push(...flattenKeys(obj[key], prefix));
            keys.push(`${prefix}.${key}`);
        } else {
            keys.push(`${prefix}.${key}`);
        }
    }
    return keys;
};

const availableKeys = flattenKeys(activities);

// Find missing keys
const missingKeys = keysInDatabase.filter(key => {
    // Check if key exists in activities in some form
    const simplifiedKey = key
        .replace(/^activity\.log_activity\./, 'activities.fields.')
        .replace(/^activity\./, 'activities.fields.')
        .replace(/^dashboard\./, 'dashboard.')
        .replace(/^dispute\./, 'disputes.')
        .replace(/^disputes\./, 'disputes.');

    // Check various possible matches
    const possibleMatches = [
        simplifiedKey,
        simplifiedKey.replace(/^activities\.fields\./, 'activities.values.'),
        simplifiedKey.replace(/^activities\.fields\./, 'activities.sections.'),
        key.replace(/^activity\./, '').replace(/^dashboard\./, '').replace(/^dispute\./, 'disputes.'),
    ];

    return !availableKeys.some(ak => possibleMatches.some(pm => ak === pm || ak.endsWith(`.${pm}`)));
});

console.log('========================================');
console.log('MISSING KEYS IN activities.json');
console.log('========================================\n');
console.log('Total keys to check:', keysInDatabase.length);
console.log('Missing keys:', missingKeys.length);
console.log('\nMissing keys list:\n');
missingKeys.forEach((key, index) => {
    console.log(`${index + 1}. ${key}`);
});

console.log('\n========================================');
console.log('Keys that likely need mapping:');
console.log('========================================\n');

// Suggest mappings for missing keys
const mappingSuggestions = missingKeys.map(key => {
    let suggestion = '';

    if (key.startsWith('activity.log_activity.')) {
        const shortKey = key.replace('activity.log_activity.', '');
        if (['comment', 'contact', 'dispute_reason', 'follow_up_time', 'outgoing_call', 'incoming_call'].includes(shortKey)) {
            suggestion = `→ Should map to: activities.fields.log_activity_${shortKey}`;
        } else if (shortKey.startsWith('outcomes.')) {
            const outcome = shortKey.replace('outcomes.', '');
            suggestion = `→ Should map to: activities.values.outcomes_${outcome}`;
        }
    } else if (key.startsWith('dispute.dispute_status.')) {
        const status = key.replace('dispute.dispute_status.', '');
        suggestion = `→ Should map to: disputes.values.status_${status}`;
    }

    return `${key}\n  ${suggestion || '(No auto-suggestion available)'}`;
});

mappingSuggestions.forEach(s => console.log(s));


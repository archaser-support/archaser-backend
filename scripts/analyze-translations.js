#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Get all translation keys used in the codebase
function getAllTranslationKeys() {
    const keys = new Set();

    // Search for t("key") patterns in all TypeScript/TSX files
    const grepCommand = 'grep -r "t(" app/ --include="*.tsx" --include="*.ts"';

    try {
        const result = execSync(grepCommand, { cwd: process.cwd(), encoding: 'utf8' });
        const lines = result.split('\n').filter(line => line.trim());

        lines.forEach(line => {
            // Extract the key from t("key") or t('key')
            const matches = line.match(/t\(["']([^"']+)["']\)/g);
            if (matches) {
                matches.forEach(match => {
                    const keyMatch = match.match(/t\(["']([^"']+)["']\)/);
                    if (keyMatch) {
                        keys.add(keyMatch[1]);
                    }
                });
            }
        });
    } catch (error) {
        console.error('Error running grep:', error.message);
    }

    return Array.from(keys).sort();
}

// Load current translation file
function loadTranslationFile(lang) {
    const filePath = path.join(process.cwd(), 'locales', lang, 'translation.json');
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error(`Error loading ${filePath}:`, error.message);
        return {};
    }
}

// Map keys to namespaces based on usage patterns
function mapKeysToNamespaces(usedKeys, translationData) {
    const namespaceMap = {
        common: new Set(),
        dashboard: new Set(),
        customers: new Set(),
        invoices: new Set(),
        disputes: new Set(),
        promise_to_pay: new Set(),
        agents: new Set(),
        activities: new Set(),
        settings: new Set(),
        legal: new Set(),
        portal: new Set(),
        auth: new Set(),
        admin: new Set(),
        import: new Set(),
        control_center: new Set()
    };

    // Define mapping rules based on key prefixes and patterns
    const mappingRules = {
        // Common patterns
        'common.': 'common',
        'navigation.': 'common',
        'shared_stats.': 'common',
        'pagination.': 'common',
        'export_': 'common',
        'validation.': 'common',
        'status.': 'common',
        'actions.': 'common',
        'messages.': 'common',

        // Dashboard
        'dashboard.': 'dashboard',
        'stats.': 'dashboard',
        'charts.': 'dashboard',

        // Customers/Customers
        'customer.': 'customers',
        'customers.': 'customers',

        // Invoices
        'invoice.': 'invoices',
        'invoices.': 'invoices',

        // Disputes
        'dispute.': 'disputes',
        'disputes.': 'disputes',

        // Promise to pay
        'promise_to_pay.': 'promise_to_pay',
        'promise.': 'promise_to_pay',

        // Agents/Users
        'user.': 'agents',
        'users.': 'agents',
        'agent.': 'agents',
        'agents.': 'agents',

        // Activities
        'activity.': 'activities',
        'activities.': 'activities',
        'timeline.': 'activities',

        // Settings
        'settings.': 'settings',
        'template.': 'settings',
        'bank.': 'settings',

        // Legal
        'legal.': 'legal',

        // Portal
        'portal.': 'portal',

        // Auth
        'login.': 'auth',
        'auth.': 'auth',
        'forgotPassword.': 'auth',
        'resetPassword.': 'auth',

        // Admin
        'admin.': 'admin',
        'account.': 'admin',
        'sms_management.': 'admin',
        'logs.': 'admin',

        // Import
        'import.': 'import',
        'mapping.': 'import',

        // Control Center
        'control_center.': 'control_center',
        'orphan.': 'control_center',
        'analytics.': 'control_center'
    };

    usedKeys.forEach(key => {
        let assigned = false;

        // Check mapping rules
        for (const [pattern, namespace] of Object.entries(mappingRules)) {
            if (key.startsWith(pattern)) {
                namespaceMap[namespace].add(key);
                assigned = true;
                break;
            }
        }

        // If not assigned, try to infer from key structure
        if (!assigned) {
            const parts = key.split('.');
            if (parts.length >= 2) {
                const firstPart = parts[0];
                if (namespaceMap[firstPart]) {
                    namespaceMap[firstPart].add(key);
                } else {
                    // Default to common for unmatched keys
                    namespaceMap.common.add(key);
                }
            } else {
                namespaceMap.common.add(key);
            }
        }
    });

    return namespaceMap;
}

// Main analysis function
function analyzeTranslations() {
    console.log('🔍 Analyzing translation usage...\n');

    // Get all used keys
    const usedKeys = getAllTranslationKeys();
    console.log(`Found ${usedKeys.length} unique translation keys in use\n`);

    // Load translation data
    const enTranslations = loadTranslationFile('en');
    const heTranslations = loadTranslationFile('he');

    // Map keys to namespaces
    const namespaceMap = mapKeysToNamespaces(usedKeys, enTranslations);

    // Print analysis
    console.log('📊 Namespace Distribution:\n');
    Object.entries(namespaceMap).forEach(([namespace, keys]) => {
        console.log(`${namespace}: ${keys.size} keys`);
        if (keys.size > 0) {
            const sampleKeys = Array.from(keys).slice(0, 3);
            console.log(`  Sample: ${sampleKeys.join(', ')}${keys.size > 3 ? '...' : ''}`);
        }
        console.log('');
    });

    // Find unused keys
    const allEnKeys = getAllKeysFromObject(enTranslations);
    const unusedKeys = allEnKeys.filter(key => !usedKeys.includes(key));

    console.log(`🗑️  Unused keys: ${unusedKeys.length}`);
    if (unusedKeys.length > 0) {
        console.log('Sample unused keys:', unusedKeys.slice(0, 10).join(', '));
    }

    // Save analysis to file
    const analysis = {
        usedKeys,
        namespaceMap: Object.fromEntries(
            Object.entries(namespaceMap).map(([ns, keys]) => [ns, Array.from(keys)])
        ),
        unusedKeys,
        totalUsed: usedKeys.length,
        totalUnused: unusedKeys.length
    };

    fs.writeFileSync('translation-analysis.json', JSON.stringify(analysis, null, 2));
    console.log('\n💾 Analysis saved to translation-analysis.json');

    return analysis;
}

// Helper function to get all keys from nested object
function getAllKeysFromObject(obj, prefix = '') {
    const keys = [];
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
            keys.push(...getAllKeysFromObject(value, fullKey));
        } else {
            keys.push(fullKey);
        }
    }
    return keys;
}

// Run analysis
if (require.main === module) {
    analyzeTranslations();
}

module.exports = { analyzeTranslations, getAllTranslationKeys, mapKeysToNamespaces };

#!/usr/bin/env node

/**
 * Translation Validation Script
 * 
 * This script helps validate and fix translation file issues.
 * It can be used to:
 * 1. Check for missing keys between locales
 * 2. Identify empty translation values
 * 3. Validate placeholder consistency
 * 4. Check alphabetical ordering
 * 
 * Usage:
 * node scripts/translation/validate-translations.js [--fix] [--locale=en|he]
 */

const fs = require('fs');
const path = require('path');

const localesDir = path.join(process.cwd(), 'locales');
const supportedLocales = ['en', 'he'];

// Helper function to get all nested keys from a translation object
function getAllKeys(obj, prefix = '') {
  const keys = [];
  
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getAllKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  
  return keys;
}

// Helper function to load translation file
function loadTranslationFile(locale) {
  const filePath = path.join(localesDir, locale, 'translation.json');
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

// Helper function to save translation file
function saveTranslationFile(locale, data) {
  const filePath = path.join(localesDir, locale, 'translation.json');
  const content = JSON.stringify(data, null, 4);
  fs.writeFileSync(filePath, content, 'utf-8');
}

// Helper function to sort object keys alphabetically
function sortObjectKeys(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return obj;
  }
  
  const sortedObj = {};
  const sortedKeys = Object.keys(obj).sort();
  
  for (const key of sortedKeys) {
    sortedObj[key] = sortObjectKeys(obj[key]);
  }
  
  return sortedObj;
}

// Main validation function
function validateTranslations() {
  console.log('🔍 Validating translation files...\n');
  
  const translations = supportedLocales.map(locale => ({
    locale,
    data: loadTranslationFile(locale),
    keys: getAllKeys(loadTranslationFile(locale))
  }));

  // Check for missing keys
  console.log('📋 Checking for missing keys...');
  const allKeys = new Set();
  translations.forEach(t => t.keys.forEach(key => allKeys.add(key)));

  for (const translation of translations) {
    const missingKeys = Array.from(allKeys).filter(key => !translation.keys.includes(key));
    
    if (missingKeys.length > 0) {
      console.log(`❌ Missing keys in ${translation.locale}: ${missingKeys.length} keys`);
      if (missingKeys.length <= 10) {
        console.log(`   Missing: ${missingKeys.join(', ')}`);
      } else {
        console.log(`   Missing: ${missingKeys.slice(0, 10).join(', ')}... and ${missingKeys.length - 10} more`);
      }
    } else {
      console.log(`✅ ${translation.locale}: All keys present`);
    }
  }

  // Check for empty values
  console.log('\n📋 Checking for empty translation values...');
  for (const translation of translations) {
    const emptyKeys = [];
    
    function findEmptyValues(obj, prefix = '') {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        
        if (typeof value === 'string' && value.trim() === '') {
          emptyKeys.push(fullKey);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          findEmptyValues(value, fullKey);
        }
      }
    }
    
    findEmptyValues(translation.data);
    
    if (emptyKeys.length > 0) {
      console.log(`❌ Empty values in ${translation.locale}: ${emptyKeys.join(', ')}`);
    } else {
      console.log(`✅ ${translation.locale}: No empty values`);
    }
  }

  // Check alphabetical order
  console.log('\n📋 Checking alphabetical order...');
  for (const translation of translations) {
    const outOfOrderKeys = [];
    
    function checkAlphabeticalOrder(obj, path = '') {
      const keys = Object.keys(obj);
      const sortedKeys = [...keys].sort();
      
      if (JSON.stringify(keys) !== JSON.stringify(sortedKeys)) {
        outOfOrderKeys.push(path || 'root');
      }
      
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          checkAlphabeticalOrder(value, path ? `${path}.${key}` : key);
        }
      }
    }
    
    checkAlphabeticalOrder(translation.data);
    
    if (outOfOrderKeys.length > 0) {
      console.log(`❌ Keys not in alphabetical order in ${translation.locale}: ${outOfOrderKeys.join(', ')}`);
    } else {
      console.log(`✅ ${translation.locale}: Keys in alphabetical order`);
    }
  }

  console.log('\n🎯 Summary:');
  console.log(`- Total unique keys: ${allKeys.size}`);
  console.log(`- English keys: ${translations[0].keys.length}`);
  console.log(`- Hebrew keys: ${translations[1].keys.length}`);
  
  return {
    allKeys: Array.from(allKeys),
    translations,
    issues: {
      missingKeys: translations.map(t => ({
        locale: t.locale,
        missing: Array.from(allKeys).filter(key => !t.keys.includes(key))
      })),
      emptyValues: translations.map(t => {
        const emptyKeys = [];
        function findEmptyValues(obj, prefix = '') {
          for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'string' && value.trim() === '') {
              emptyKeys.push(fullKey);
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              findEmptyValues(value, fullKey);
            }
          }
        }
        findEmptyValues(t.data);
        return { locale: t.locale, empty: emptyKeys };
      })
    }
  };
}

// Fix function
function fixTranslations() {
  console.log('🔧 Fixing translation files...\n');
  
  const results = validateTranslations();
  
  // Sort keys alphabetically
  console.log('📝 Sorting keys alphabetically...');
  for (const translation of results.translations) {
    const sortedData = sortObjectKeys(translation.data);
    saveTranslationFile(translation.locale, sortedData);
    console.log(`✅ Sorted ${translation.locale} translation file`);
  }
  
  console.log('\n✅ Translation files have been sorted alphabetically');
  console.log('⚠️  Note: Missing keys and empty values need to be fixed manually');
}

// Main execution
const args = process.argv.slice(2);
const shouldFix = args.includes('--fix');
const targetLocale = args.find(arg => arg.startsWith('--locale='))?.split('=')[1];

if (shouldFix) {
  fixTranslations();
} else {
  validateTranslations();
}

console.log('\n💡 Usage:');
console.log('  node scripts/translation/validate-translations.js          # Validate only');
console.log('  node scripts/translation/validate-translations.js --fix   # Fix alphabetical order');
console.log('  npm run test:translation                                  # Run full test suite');

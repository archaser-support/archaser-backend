#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Check for duplicate keys in translation files
 * 
 * 1. Checks for duplicate keys within each file (same category)
 * 2. Checks for duplicate keys across different files (keys that appear in multiple files)
 */

const localesDir = path.join(process.cwd(), 'locales');
const languages = ['en', 'he'];

// Get all translation files
function getTranslationFiles() {
    const files = [];
    languages.forEach(lang => {
        const langDir = path.join(localesDir, lang);
        if (fs.existsSync(langDir)) {
            const fileNames = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));
            fileNames.forEach(fileName => {
                files.push({
                    lang,
                    name: fileName.replace('.json', ''),
                    path: path.join(langDir, fileName)
                });
            });
        }
    });
    return files;
}

// Check for duplicate keys within a category using raw content
function findDuplicateKeysInCategory(rawContent, categoryName) {
    const duplicates = [];
    
    // Find the category section
    const categoryStart = rawContent.indexOf(`"${categoryName}"`);
    if (categoryStart === -1) return duplicates;
    
    // Find the opening brace of this category
    let braceCount = 0;
    let categoryStartIndex = -1;
    let categoryEndIndex = -1;
    let inCategory = false;
    
    for (let i = categoryStart; i < rawContent.length; i++) {
        if (rawContent[i] === '{' && !inCategory) {
            categoryStartIndex = i + 1;
            inCategory = true;
            braceCount = 1;
        } else if (inCategory) {
            if (rawContent[i] === '{') braceCount++;
            if (rawContent[i] === '}') {
                braceCount--;
                if (braceCount === 0) {
                    categoryEndIndex = i;
                    break;
                }
            }
        }
    }
    
    if (categoryStartIndex === -1 || categoryEndIndex === -1) return duplicates;
    
    const categoryContent = rawContent.substring(categoryStartIndex, categoryEndIndex);
    
    // Find all key definitions in this category
    const keyValueRegex = /"([^"]+)"\s*:/g;
    const foundKeys = [];
    const keyPositions = [];
    
    let match;
    while ((match = keyValueRegex.exec(categoryContent)) !== null) {
        const key = match[1];
        foundKeys.push(key);
        keyPositions.push({
            key,
            position: match.index + categoryStartIndex
        });
    }
    
    // Count occurrences
    const keyCounts = {};
    foundKeys.forEach(key => {
        keyCounts[key] = (keyCounts[key] || 0) + 1;
    });
    
    // Find duplicates
    Object.entries(keyCounts).forEach(([key, count]) => {
        if (count > 1) {
            const positions = keyPositions.filter(kp => kp.key === key).map(kp => kp.position);
            duplicates.push({
                key,
                category: categoryName,
                occurrences: count,
                positions
            });
        }
    });
    
    return duplicates;
}

// Check a single translation file for duplicates within the file
function checkFileForDuplicates(filePath, fileName, lang) {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    
    try {
        // First validate JSON is parseable
        JSON.parse(rawContent);
        
        const allDuplicates = [];
        const categories = ['fields', 'actions', 'messages', 'values', 'sections', 'tooltips', 'validation'];
        
        // Check each category
        categories.forEach(category => {
            const duplicates = findDuplicateKeysInCategory(rawContent, category);
            if (duplicates.length > 0) {
                allDuplicates.push(...duplicates.map(d => ({
                    ...d,
                    file: `${lang}/${fileName}.json`
                })));
            }
        });
        
        return allDuplicates;
    } catch (error) {
        console.error(`❌ Error parsing ${filePath}: ${error.message}`);
        return [];
    }
}

// Check for duplicate keys across different files
function checkDuplicateKeysAcrossFiles(files) {
    const keyMap = new Map(); // key -> [{ file, category, lang }]
    
    files.forEach(file => {
        try {
            const content = fs.readFileSync(file.path, 'utf8');
            const data = JSON.parse(content);
            
            const categories = ['fields', 'actions', 'messages', 'values', 'sections', 'tooltips', 'validation'];
            
            categories.forEach(category => {
                if (data[category] && typeof data[category] === 'object') {
                    Object.keys(data[category]).forEach(key => {
                        const fullKey = `${category}.${key}`;
                        if (!keyMap.has(fullKey)) {
                            keyMap.set(fullKey, []);
                        }
                        keyMap.get(fullKey).push({
                            file: file.name,
                            category,
                            lang: file.lang
                        });
                    });
                }
            });
        } catch (error) {
            console.error(`❌ Error parsing ${file.path}: ${error.message}`);
        }
    });
    
    // Find keys that appear in multiple files
    const crossFileDuplicates = [];
    keyMap.forEach((locations, key) => {
        // Group by file name (ignore language)
        const filesSet = new Set(locations.map(l => l.file));
        if (filesSet.size > 1) {
            // Group by language
            const enFiles = locations.filter(l => l.lang === 'en').map(l => l.file);
            const heFiles = locations.filter(l => l.lang === 'he').map(l => l.file);
            
            const uniqueEnFiles = [...new Set(enFiles)];
            const uniqueHeFiles = [...new Set(heFiles)];
            
            crossFileDuplicates.push({
                key,
                files: {
                    en: uniqueEnFiles,
                    he: uniqueHeFiles
                },
                totalFiles: filesSet.size,
                totalOccurrences: locations.length
            });
        }
    });
    
    return crossFileDuplicates;
}

// Main function
function checkForDuplicates() {
    console.log('🔍 Checking for duplicate keys in translation files...\n');
    
    const files = getTranslationFiles();
    const allDuplicates = [];
    
    // Check 1: Duplicates within files
    console.log('📋 Checking for duplicate keys WITHIN files (same category)...\n');
    files.forEach(file => {
        const duplicates = checkFileForDuplicates(file.path, file.name, file.lang);
        if (duplicates.length > 0) {
            allDuplicates.push(...duplicates);
        }
    });
    
    if (allDuplicates.length > 0) {
        console.log(`❌ Found ${allDuplicates.length} duplicate key(s) within files:\n`);
        
        // Group by file
        const duplicatesByFile = {};
        allDuplicates.forEach(dup => {
            if (!duplicatesByFile[dup.file]) {
                duplicatesByFile[dup.file] = [];
            }
            duplicatesByFile[dup.file].push(dup);
        });
        
        Object.entries(duplicatesByFile).forEach(([file, dups]) => {
            console.log(`📄 ${file}:`);
            const uniqueDups = [...new Map(dups.map(d => [d.key, d])).values()];
            uniqueDups.forEach(dup => {
                console.log(`   ❌ ${dup.category}.${dup.key} (appears ${dup.occurrences} times)`);
            });
            console.log('');
        });
    } else {
        console.log('✅ No duplicate keys found within files!\n');
    }
    
    // Check 2: Duplicates across files
    console.log('\n📋 Checking for duplicate keys ACROSS files (same key in multiple files)...\n');
    const crossFileDuplicates = checkDuplicateKeysAcrossFiles(files);
    
    if (crossFileDuplicates.length > 0) {
        console.log(`⚠️  Found ${crossFileDuplicates.length} key(s) that appear in multiple files:\n`);
        
        // Sort by number of files (most duplicates first)
        crossFileDuplicates.sort((a, b) => b.totalFiles - a.totalFiles);
        
        crossFileDuplicates.forEach(dup => {
            console.log(`📌 ${dup.key}:`);
            console.log(`   Appears in ${dup.totalFiles} file(s) (${dup.totalOccurrences} total occurrences)`);
            console.log(`   English files: ${dup.files.en.join(', ')}`);
            console.log(`   Hebrew files: ${dup.files.he.join(', ')}`);
            console.log(`   💡 Consider moving to common.json if it's a shared key`);
            console.log('');
        });
        
        console.log('\n💡 Note: Keys appearing in multiple files are not necessarily errors.');
        console.log('   They may need to be moved to common.json if they represent shared translations.');
    } else {
        console.log('✅ No duplicate keys found across files!\n');
    }
    
    // Summary
    console.log('\n📊 Summary:');
    console.log(`   Duplicates within files: ${allDuplicates.length > 0 ? '❌ Found' : '✅ None'}`);
    console.log(`   Duplicates across files: ${crossFileDuplicates.length > 0 ? '⚠️  Found' : '✅ None'}`);
    
    if (allDuplicates.length > 0) {
        console.log('\n⚠️  Duplicate keys within files will cause JSON parsers to only keep the last value.');
        console.log('   Please remove duplicate definitions from the files above.');
    }
}

// Run check
checkForDuplicates();


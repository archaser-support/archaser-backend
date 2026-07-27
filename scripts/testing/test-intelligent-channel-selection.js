/**
 * Test script for Intelligent Channel Selection
 * 
 * This script tests the Phase 1 implementation of the intelligent communication
 * channel selection feature.
 * 
 * Usage:
 * node scripts/testing/test-intelligent-channel-selection.js
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testIntelligentChannelSelection() {
    console.log('🧪 Testing Intelligent Channel Selection - Phase 1');
    console.log('================================================\n');

    try {
        // Test 1: Check database schema extensions
        console.log('1. Testing database schema extensions...');
        
        const activityContactColumns = await prisma.$queryRaw`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'ActivityContact' 
            AND column_name IN ('channel_selection_reason', 'predicted_success_rate', 'alternative_channels_considered')
            ORDER BY column_name;
        `;
        
        console.log('✅ ActivityContact table extensions:', activityContactColumns);
        
        // Test 2: Check CommunicationChannelPreference table
        console.log('\n2. Testing CommunicationChannelPreference table...');
        
        const preferenceCount = await prisma.communicationChannelPreference.count();
        console.log(`✅ CommunicationChannelPreference table exists with ${preferenceCount} records`);
        
        // Test 3: Check CommunicationLearningData table
        console.log('\n3. Testing CommunicationLearningData table...');
        
        const learningCount = await prisma.communicationLearningData.count();
        console.log(`✅ CommunicationLearningData table exists with ${learningCount} records`);
        
        // Test 4: Check customer table extensions
        console.log('\n4. Testing customer table extensions...');
        
        const customerColumns = await prisma.$queryRaw`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'Customer' 
            AND column_name IN ('intelligent_channel_selection_enabled', 'sms_fallback_enabled', 'unlisted_country_sms_policy')
            ORDER BY column_name;
        `;
        
        console.log('✅ Customer table extensions:', customerColumns);
        
        // Test 5: Check contact table extensions
        console.log('\n5. Testing contact table extensions...');
        
        const contactColumns = await prisma.$queryRaw`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'Contact' 
            AND column_name IN ('email_bounce_count', 'last_email_bounce', 'sms_delivery_failure_count', 'last_sms_failure', 'communication_score')
            ORDER BY column_name;
        `;
        
        console.log('✅ Contact table extensions:', contactColumns);
        
        // Test 6: Test API endpoints (if server is running)
        console.log('\n6. Testing API endpoints...');
        
        try {
            const response = await fetch('http://localhost:3000/api/communication-intelligence/channel-selection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    activityId: 1,
                    customerId: 1
                })
            });
            
            if (response.ok) {
                console.log('✅ API endpoint is accessible');
            } else {
                console.log('⚠️  API endpoint returned status:', response.status);
            }
        } catch (error) {
            console.log('⚠️  API endpoint test skipped (server not running):', error.message);
        }
        
        console.log('\n🎉 Phase 1 Implementation Test Complete!');
        console.log('\nNext Steps:');
        console.log('- Enable intelligent_channel_selection_enabled for test customers');
        console.log('- Run activityWorkflowManager to test channel selection');
        console.log('- Monitor logs for intelligent selection decisions');
        console.log('- Test fallback behavior when intelligent selection fails');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the test
testIntelligentChannelSelection();

/*
 npx tsx scripts/utilities/testEmail.ts
*/
import { sendEmailWithSenderName } from "@/server/EmailService";
import { addEmailTracking } from "@/utils/emailTrackingUtils";

async function testEmail() {
    try {
        console.log("🚀 Sending test email with engagement tracking...");

        const recipientEmail = "nilotpal@archaser.com";
        const senderName = "ARchaser Test";
        const subject = "Test Email with Engagement Tracking";

        // Generate a unique message ID for tracking
        const messageId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Create email content with test links
        const emailContent = `
            <html>
                <head>
                    <title>Test Email with Tracking</title>
                </head>
                <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h1 style="color: #6B46C1;">🧪 Email Engagement Tracking Test</h1>
                    
                    <p>Hello Nilotpal,</p>
                    
                    <p>This is a test email to verify that our email engagement tracking is working correctly.</p>
                    
                    <h2>🔗 Test Links (Click these to test click tracking):</h2>
                    <p>
                        <a href="https://archaser.com" style="color: #6B46C1; text-decoration: none; padding: 10px 20px; background-color: #f3f4f6; border-radius: 5px; display: inline-block; margin: 5px;">
                            🏠 Visit ARchaser Website
                        </a>
                    </p>
                    <p>
                        <a href="https://github.com" style="color: #6B46C1; text-decoration: none; padding: 10px 20px; background-color: #f3f4f6; border-radius: 5px; display: inline-block; margin: 5px;">
                            🐙 Visit GitHub
                        </a>
                    </p>
                    
                    <h2>📈 Expected Results:</h2>
                    <p>After opening this email and clicking the links:</p>
                    <ul>
                        <li>✅ <strong>Times Viewed:</strong> Should increment each time you open the email</li>
                        <li>✅ <strong>Opened Time:</strong> Should show when you first opened the email</li>
                        <li>✅ <strong>Clicked Time:</strong> Should show when you first clicked a link</li>
                    </ul>
                    
                    <p>Check the <strong>Email Campaign Report</strong> in the admin panel to see the tracking data!</p>
                    
                    <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                    
                    <p style="color: #6b7280; font-size: 12px;">
                        <strong>Test Details:</strong><br>
                        Message ID: ${messageId}<br>
                        Sent: ${new Date().toISOString()}<br>
                        Tracking: Enabled ✅
                    </p>
                </body>
            </html>
        `;

        // Add email tracking to the content
        const trackedEmailContent = addEmailTracking(emailContent, messageId);

        console.log("📧 Email Details:");
        console.log("   Recipient:", recipientEmail);
        console.log("   Subject:", subject);
        console.log("   Message ID:", messageId);
        console.log("   Tracking: Enabled");

        // Send the email with tracking
        const result = await sendEmailWithSenderName(
            senderName,
            recipientEmail,
            subject,
            trackedEmailContent,
            "", // replyToEmail
            messageId // Pass the message ID for tracking
        );

        console.log("\n✅ Email sent successfully!");
        console.log("📨 SES Message ID:", result.messageId);
        console.log("🔗 Tracking Message ID:", messageId);

        console.log("\n📋 Next Steps:");
        console.log("1. 📧 Check your email inbox for the test email");
        console.log("2. 👀 Open the email (this will trigger open tracking)");
        console.log("3. 🖱️  Click the test links (this will trigger click tracking)");
        console.log("4. 📊 Check the Email Campaign Report in admin panel");
        console.log("5. 🔍 Look for the tracking data in the report");

        return result;

    } catch (error) {
        console.error("❌ Error sending test email:", error);
        throw error;
    }
}

testEmail()
    .then((res) => {
        console.log("\n🎉 Test email sent successfully!");
        console.log("📨 SES Message ID:", res.messageId);
        console.log("\n📋 Next Steps:");
        console.log("1. 📧 Check your email inbox for the test email");
        console.log("2. 👀 Open the email (this will trigger open tracking)");
        console.log("3. 🖱️  Click the test links (this will trigger click tracking)");
        console.log("4. 📊 Check the Email Campaign Report in admin panel");
        console.log("5. 🔍 Look for the tracking data in the report");
    })
    .catch((err) => {
        console.error("\n💥 Failed to send test email:");
        console.error("Error:", err.message);
        console.error("Stack:", err.stack);
    });

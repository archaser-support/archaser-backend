INSERT INTO "SELECT 
    atl.id,
    atl.created_at,
    atl.modified_at,
    atl.template_id,
    atl.language,
    atl.sms_content,
    atl.whatsapp_content,
    atl.email_subject,
    atl.email_content
FROM ""ActivityTemplateLanguage"" atl
INNER JOIN ""ActivitiesTemplate"" at ON atl.template_id = at.id
WHERE atl.language = 'English' 
  AND at.master_template = true" (created_at,modified_at,template_id,"language",sms_content,whatsapp_content,email_subject,email_content) VALUES
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',32,'English','Hello {first_name}, to avoid any potential inconveniences, please settle {debor_name}''s outstanding balance with {customer_name} here: {link}. Thank you!','Hello {first_name}, to avoid any potential inconveniences, please settle {debor_name}''s outstanding balance with {customer_name} here: {link}. Thank you!','Avoid Inconvenience: Settle Outstanding Debt with {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          To avoid any potential inconveniences, please settle <strong>{customer_name}</strong>''s outstanding balance with <strong>{customer_name}</strong> here:
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Settle Balance
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">Thank you for your swift action.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',31,'English','Hello {first_name}, we kindly ask for your cooperation in settling {debor_name}''s outstanding balance with {customer_name}. Please use this link to settle: {link}. Thank you!','Hello {first_name}, we kindly ask for your cooperation in settling {debor_name}''s outstanding balance with {customer_name}. Please use this link to settle: {link}. Thank you!','Request for Cooperation in Settling Debt with {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 40px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: auto; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px;">
      <tr>
        <td style="padding: 30px; color: #333333;">
          <h2 style="color: #2a4d69; margin-top: 0;">Hello {first_name},</h2>
          <p style="font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
            We kindly ask for your prompt attention in settling <strong>{customer_name}</strong>''s outstanding balance with <strong>{customer_name}</strong>.
          </p>
          <p style="text-align: center; margin-bottom: 30px;">
            <a href="{link}" style="background-color: #4CAF50; color: white; text-decoration: none; padding: 12px 20px; border-radius: 5px; font-weight: bold;">
              Settle Payment
            </a>
          </p>
          <p style="font-size: 16px; line-height: 1.5;">
            Thank you for your immediate action.
          </p>
          <p style="margin-top: 40px; font-size: 16px;">
            Best regards,<br>
            <strong>{customer_name} team</strong>
          </p>
        </td>
      </tr>
    </table>
  </body>
  '),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',34,'English','Hello {first_name}, we are here to assist you in settling {debor_name}''s outstanding balance with {customer_name}. Settle it here: {link}. Thank you!','Hello {first_name}, we are here to assist you in settling {debor_name}''s outstanding balance with {customer_name}. Settle it here: {link}. Thank you!','We’re Here to Assist: Settle {customer_name}''s Debt with {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          We are here to assist you in settling <strong>{customer_name}</strong>''s outstanding balance with <strong>{customer_name}</strong>. Please use the link below:
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Settle Balance
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">Thank you for your prompt cooperation.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',38,'English','Hello {first_name}, unpaid debts may lead to legal action. Please settle {debor_name}''s balance here: {link}. Thank you!','Hello {first_name}, unpaid debts may lead to legal action. Please settle {debor_name}''s balance here: {link}. Thank you!','Reminder: Legal Action for Unpaid Debt at {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          Unpaid debts may be subject to legal action. Please settle <strong>{customer_name}</strong>''s debt with <strong>{customer_name}</strong> here:
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Settle Now
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">Thank you for your prompt response.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',802,'English','Hi {first_name}, your dispute request has been reviewed and corrected. There is still an outstanding balance to be settled. Please make the payment here: {link} 
{customer_name} Team','Hi {first_name}, your dispute request has been reviewed and corrected. There is still an outstanding balance to be settled. Please make the payment here: {link} 
{customer_name} Team','Dispute Request - Resolution Update','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hi <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          Thank you for your patience while we reviewed your dispute request. We have made the necessary corrections to the account details. There is still an outstanding balance to be settled.
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Make a Payment
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">We appreciate your cooperation.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} Team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',803,'English','Hi {first_name}, your dispute request has been canceled. There is still an outstanding balance to be settled. Please make the payment here: {link} 
{customer_name} Team','Hi {first_name}, your dispute request has been canceled. There is still an outstanding balance to be settled. Please make the payment here: {link} 
{customer_name} Team','Dispute Request - Canceled','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hi <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          We have received confirmation that your dispute request has been canceled. There is still an outstanding balance to be settled.
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Make Payment
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">Thank you for your swift action.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} Team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',83,'English','Hi {first_name}, your dispute request has been resolved. No further action is required. Thank you {customer_name} Team','Hi {first_name}, your dispute request has been resolved. No further action is required. Thank you {customer_name} Team','Dispute Request - Resolution Update','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hi <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          Thank you for your patience while we reviewed your dispute request. We are pleased to inform you that the matter has been fully resolved. No further action is required.
        </p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} Team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',35,'English','Hello {first_name}, a friendly reminder that outstanding debts do not disappear. Please settle {debor_name}''s balance with {customer_name} here: {link}. Thank you!','Hello {first_name}, a friendly reminder that outstanding debts do not disappear. Please settle {debor_name}''s balance with {customer_name} here: {link}. Thank you!','Reminder: Outstanding Debt Does Not Disappear at {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          A friendly reminder that outstanding debts do not disappear. Please settle <strong>{customer_name}</strong>''s balance with <strong>{customer_name}</strong> here:
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Settle Balance
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">Thank you for taking action.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',36,'English','Hello {first_name}, outstanding balances may cause inconveniences. Please settle {debor_name}''s balance with {customer_name} here: {link}. Thank you!','Hello {first_name}, outstanding balances may cause inconveniences. Please settle {debor_name}''s balance with {customer_name} here: {link}. Thank you!','Reminder: Possible Inconveniences Due to Outstanding Debt at {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          Please note that outstanding debts may cause inconveniences. To avoid this, please settle <strong>{customer_name}</strong>''s debt with <strong>{customer_name}</strong> here:
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Settle Debt
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">Thank you for your prompt attention.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',39,'English','Hello {first_name}, we kindly ask for your prompt attention in settling {debor_name}''s outstanding balance with {customer_name}. Settle it here: {link}. Thank you!','Hello {first_name}, we kindly ask for your prompt attention in settling {debor_name}''s outstanding balance with {customer_name}. Settle it here: {link}. Thank you!','Request for Prompt Settlement: {customer_name}''s Debt with {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          We kindly ask for your prompt attention in settling <strong>{customer_name}</strong>''s outstanding balance with <strong>{customer_name}</strong>.
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Settle Now
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">Thank you for your immediate action.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} team</strong></p>
      </td>
    </tr>
  </table>
</body>
');
INSERT INTO "SELECT 
    atl.id,
    atl.created_at,
    atl.modified_at,
    atl.template_id,
    atl.language,
    atl.sms_content,
    atl.whatsapp_content,
    atl.email_subject,
    atl.email_content
FROM ""ActivityTemplateLanguage"" atl
INNER JOIN ""ActivitiesTemplate"" at ON atl.template_id = at.id
WHERE atl.language = 'English' 
  AND at.master_template = true" (created_at,modified_at,template_id,"language",sms_content,whatsapp_content,email_subject,email_content) VALUES
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',41,'English','Hi {first_name}, your dispute request has been reviewed and adjustments were made. There is still an outstanding balance to be settled. Please make the payment here: {link} 
{customer_name} Team','Hi {first_name}, your dispute request has been reviewed and adjustments were made. There is still an outstanding balance to be settled. Please make the payment here: {link} 
{customer_name} Team','Dispute Request -  Resolution Update','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hi <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          Thank you for your patience while we reviewed your dispute request. Following our review, adjustments have been made. There is still an outstanding balance to be settled. 
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Make Payment
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">We appreciate your cooperation.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} Team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',40,'English','Hello {first_name}, a quick reminder that today is the day you promised to settle {debor_name}’s outstanding balance with {customer_name}. Please make the payment here: {link}. Thank you!','Hello {first_name}, a quick reminder that today is the day you promised to settle {debor_name}’s outstanding balance with {customer_name}. Please make the payment here: {link}. Thank you!','Reminder: You Promised to Settle {customer_name}’s Outstanding Balance Today with {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          A quick reminder that today is the day you promised to settle <strong>{customer_name}</strong>’s outstanding balance with <strong>{customer_name}</strong>.
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Make a Payment
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">Thank you for your prompt attention to this matter.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',37,'English','Hello {first_name}, {debor_name} still has an outstanding balance with {customer_name}. Please settle it here: {link}. Thank you!','Hello {first_name}, {debor_name} still has an outstanding balance with {customer_name}. Please settle it here: {link}. Thank you!','Still Outstanding: {customer_name}''s Debt with {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          <strong>{customer_name}</strong> still has an outstanding balance with <strong>{customer_name}</strong>. Please settle it promptly using the link below:
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Settle Balance
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">Thank you for your cooperation.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} team</strong></p>
      </td>
    </tr>
  </table>
</body>
'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',485,'English','Hello {first_name}, a reminder that an unpaid balance may incur additional charges. Please settle {debor_name}''s debt with {customer_name} here: {link}. Thank you!','Hello {first_name}, a reminder that an unpaid balance may incur additional charges. Please settle {debor_name}''s debt with {customer_name} here: {link}. Thank you!','Reminder: Potential Charges for Unpaid Debt at {customer_name}','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
      <tr>
        <td style="padding: 30px;">
          <p style="font-size: 16px; margin-bottom: 20px;">Hello <strong>{first_name}</strong>,</p>
          <p style="font-size: 15px; margin-bottom: 25px;">
            This is a reminder that an unpaid balance may incur additional charges. To avoid this, please settle
            <strong>{customer_name}</strong>''s debt with <strong>{customer_name}</strong> here:
          </p>
          <p style="text-align: center; margin-bottom: 30px;">
            <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
              Settle Balance
            </a>
          </p>
          <p style="font-size: 15px; margin-bottom: 20px;">Thank you for your attention to this matter.</p>
          <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} team</strong></p>
        </td>
      </tr>
    </table>
  </body>
  '),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',99,'English','Hello {first_name}, this is a reminder that {customer_name} has an outstanding balance with {customer_name}. Please settle it promptly here: {link}. Thank you!','Hello {first_name}, this is a reminder that {debor_name} has an outstanding balance with {customer_name}. Please settle it promptly here: {link}. Thank you!','Reminder: Outstanding Debt at {customer_name}',' <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; color: #333333; padding: 20px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
      <tr>
        <td style="padding: 30px;">
          <p style="font-size: 16px; color: #555555;">Dear <strong>{first_name}</strong>,</p>

          <p style="font-size: 16px; color: #555555;">
            We hope this message finds you well.
          </p>

          <p style="font-size: 16px; color: #555555;">
            We are reaching out to kindly request your assistance in settling the outstanding balance for 
            <strong>{customer_name}</strong> with <strong>{customer_name}</strong>.
          </p>

          <p style="text-align: center; margin: 30px 0;">
            <a href="{link}" 
               style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-size: 16px;">
              Settle Payment
            </a>
          </p>

          <p style="font-size: 16px; color: #555555;">
            Your prompt attention to this matter is greatly appreciated.
          </p>

          <p style="font-size: 16px; color: #555555;">
            Thank you for your cooperation.
          </p>

          <p style="font-size: 16px; color: #555555;">
            Sincerely,<br/>
            The <strong>{customer_name}</strong> Team
          </p>
        </td>
      </tr>
    </table>
  </body>'),
	 ('2025-07-15 09:41:13.256327+03','2025-07-15 09:41:13.256327+03',43,'English','Hi {first_name}, your dispute request has been reviewed. No changes were made. There is still an outstanding balance to be settled. Please make the payment here: {link} 
{customer_name} Team','Hi {first_name}, your dispute request has been reviewed. No changes were made. There is still an outstanding balance to be settled. Please make the payment here: {link} 
{customer_name} Team','Dispute Request - Review Outcome','<body style="font-family: Arial, sans-serif; background-color: #f7f9fb; padding: 20px; color: #333333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Hi <strong>{first_name}</strong>,</p>
        <p style="font-size: 15px; margin-bottom: 25px;">
          Thank you for your patience while we reviewed your dispute request. After careful consideration, no changes have been made. There is still an outstanding balance to be settled.
        </p>
        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Pay Now
          </a>
        </p>
        <p style="font-size: 15px; margin-bottom: 20px;">We appreciate your cooperation.</p>
        <p style="font-size: 15px;">Best regards,<br><strong>{customer_name} Team</strong></p>
      </td>
    </tr>
  </table>
</body>
');

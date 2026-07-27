-- =============================================================================
-- Copy ActivityTemplate id 1795 and its ActivityTemplateLanguage records
-- =============================================================================
-- Creates one template + language rows for EVERY account. master_template is
-- true only for account_id 10013, false for all others.
-- Run this script on the TARGET database.
-- =============================================================================

WITH new_templates AS (
  INSERT INTO "ActivitiesTemplate" (created_at, modified_at, name, sms_content, category, email_subject, language, active, email_content, account_id, master_template, whatsapp_content, dispute_resolution, created_by, modified_by)
  SELECT
    '2026-02-25 03:55:23.427+02'::timestamptz,
    '2026-02-25 03:55:23.427+02'::timestamptz,
    'Upcoming Payment Reminder',
    '', 'Automated'::category, '', 'English'::language, true, '',
    a.id,
    (a.id = 10013),
    '', NULL::dispute_resolution,
    'cm4jv3d130002w6tkphqo0f3l', 'cm4jv3d130002w6tkphqo0f3l'
  FROM "Account" a
  RETURNING id, account_id
),
lang_data(created_at, modified_at, language, sms_content, whatsapp_content, email_subject, email_content, created_by, modified_by) AS (
  VALUES
  ('2026-02-25 06:51:38.787+02'::timestamptz, '2026-02-25 06:51:38.787+02'::timestamptz, 'English', 'Hello {first_name}, a friendly reminder that your payment for {account_name} is due on {due_date}. View and pay here: {link}. Thank you!', 'Hello {first_name} 👋. We would like to bring to your attention that the due date for {account_name} is scheduled for {due_date}.

You can review your invoice details here: {link}

Best regards,
The {account_name} Team', 'Upcoming Payment Reminder: Invoice for {account_name}', '<table width="100%" cellpadding="0" cellspacing="0" dir="ltr" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: left; font-family: Arial, sans-serif;">
  <tbody>
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">
          Hello <strong>{first_name}</strong>,
        </p>
        
        <p style="font-size: 15px; margin-bottom: 15px; line-height: 1.6;">
          We would like to bring to your attention that the due date for 
          <strong>{account_name}</strong> 
          is scheduled for <strong>{due_date}</strong>.
        </p>

        <p style="font-size: 15px; margin-bottom: 25px; line-height: 1.6;">
          You can review the full invoice details and billing information via the link below:
        </p>

        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; display: inline-block; font-weight: bold;">
            View Invoice Details
          </a>
        </p>

        <p style="font-size: 15px; margin-bottom: 20px; color: #666666;">
          Should you have any questions or require further clarification, our team is available to assist you.
        </p>

        <p style="font-size: 15px;">
          Best regards,<br>
          <strong>The {account_name} Team</strong>
        </p>
      </td>
    </tr>
  </tbody>
</table>', 'cm4jv3d130002w6tkphqo0f3l', 'cm4jv3d130002w6tkphqo0f3l'),
  ('2026-02-25 06:51:38.791+02'::timestamptz, '2026-02-25 06:51:38.791+02'::timestamptz, 'Hebrew', 'שלום {first_name}, רצינו להפנות את תשומת לבך לכך שמועד הפירעון עבור {account_name} חל בתאריך {due_date}. לפרטים נוספים: {link}', 'שלום {first_name} 👋,

רצינו להפנות את תשומת לבך לכך שמועד הפירעון עבור {account_name} חל בתאריך {due_date}.

ניתן לצפות בפרטי החשבונית המלאים בקישור הבא:
{link}', 'תזכורת: מועד הפירעון הקרוב עבור {account_name}', '<table width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: right; font-family: Arial, sans-serif;">
  <tbody>
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">
          שלום 
          <strong>{first_name}</strong>,
        </p>
        
        <p style="font-size: 15px; margin-bottom: 15px; line-height: 1.6;">
          ברצוננו להפנות את תשומת לבך לכך שמועד הפירעון עבור 
          <strong>{account_name}</strong> 
          חל בתאריך 
          <strong>{due_date}</strong>.
        </p>

        <p style="font-size: 15px; margin-bottom: 25px; line-height: 1.6;">
          ניתן לצפות בפרטי החשבונית המלאים ובפרטי החיוב באמצעות הקישור המצורף:
        </p>

        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; display: inline-block; font-weight: bold;">
            לצפייה בפרטי החשבונית
          </a>
        </p>

        <p style="font-size: 15px; margin-bottom: 20px; color: #666666;">
          לכל שאלה או בירור נוסף, צוות התמיכה שלנו עומד לרשותך.
        </p>

        <p style="font-size: 15px;">
          בברכה,
          <br>
          <strong>צוות {account_name}</strong>
        </p>
      </td>
    </tr>
  </tbody>
</table>', 'cm4jv3d130002w6tkphqo0f3l', 'cm4jv3d130002w6tkphqo0f3l'),
  ('2026-02-25 06:51:38.793+02'::timestamptz, '2026-02-25 06:51:38.793+02'::timestamptz, 'German', 'Hallo {first_name}, wir möchten Sie auf die kommende Zahlungsfrist für {account_name} am {due_date} hinweisen. Details finden Sie hier: {link}', 'Hallo {first_name} 👋.

Wir möchten Sie höflich darauf hinweisen, dass die Zahlungsfrist für {account_name} am {due_date} abläuft.

Ihre Rechnungsdetails können Sie hier einsehen: {link}

Mit freundlichen Grüßen,
Ihr {account_name} Team', 'Zahlungshinweis: Kommende Frist für {account_name}', '<table width="100%" cellpadding="0" cellspacing="0" dir="ltr" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: left; font-family: Arial, sans-serif;">
  <tbody>
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">
          Hallo <strong>{first_name}</strong>,
        </p>
        
        <p style="font-size: 15px; margin-bottom: 15px; line-height: 1.6;">
          wir möchten Sie höflich darauf hinweisen, dass die Zahlungsfrist für 
          <strong>{account_name}</strong> am <strong>{due_date}</strong> abläuft.
        </p>

        <p style="font-size: 15px; margin-bottom: 25px; line-height: 1.6;">
          Sie können die vollständigen Rechnungsdetails und Zahlungsinformationen über den folgenden Link einsehen:
        </p>

        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Rechnungsdetails anzeigen
          </a>
        </p>

        <p style="font-size: 15px; margin-bottom: 20px; color: #666666;">
          Sollten Sie Fragen haben oder weitere Informationen benötigen, steht Ihnen unser Team gerne zur Verfügung.
        </p>

        <p style="font-size: 15px;">
          Mit freundlichen Grüßen,<br>
          <strong>Ihr {account_name} Team</strong>
        </p>
      </td>
    </tr>
  </tbody>
</table>', 'cm4jv3d130002w6tkphqo0f3l', 'cm4jv3d130002w6tkphqo0f3l'),
  ('2026-02-25 06:51:38.794+02'::timestamptz, '2026-02-25 06:51:38.794+02'::timestamptz, 'Spanish', 'Hola {first_name}, le informamos que la fecha de vencimiento para {account_name} es el {due_date}. Consulte los detalles aquí: {link}', 'Hola {first_name} 👋.

Le informamos que la fecha de vencimiento para {account_name} está programada para el {due_date}.

Puede revisar los detalles de su factura aquí: {link}

Atentamente,
El equipo de {account_name}', 'Recordatorio: Próxima fecha de vencimiento de {account_name}', '<table width="100%" cellpadding="0" cellspacing="0" dir="ltr" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: left; font-family: Arial, sans-serif;">
  <tbody>
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">
          Hola <strong>{first_name}</strong>,
        </p>
        
        <p style="font-size: 15px; margin-bottom: 15px; line-height: 1.6;">
          Le informamos que la fecha de vencimiento para 
          <strong>{account_name}</strong> está programada para el <strong>{due_date}</strong>.
        </p>

        <p style="font-size: 15px; margin-bottom: 25px; line-height: 1.6;">
          Puede revisar los detalles completos de su factura y la información de facturación a través del siguiente enlace:
        </p>

        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Ver detalles de la factura
          </a>
        </p>

        <p style="font-size: 15px; margin-bottom: 20px; color: #666666;">
          Si tiene alguna pregunta o necesita más información, nuestro equipo está a su disposición para ayudarle.
        </p>

        <p style="font-size: 15px;">
          Atentamente,<br>
          <strong>El equipo de {account_name}</strong>
        </p>
      </td>
    </tr>
  </tbody>
</table>', 'cm4jv3d130002w6tkphqo0f3l', 'cm4jv3d130002w6tkphqo0f3l'),
  ('2026-02-25 06:51:38.795+02'::timestamptz, '2026-02-25 06:51:38.795+02'::timestamptz, 'French', 'Bonjour {first_name}, nous attirons votre attention sur l''échéance de {account_name} prévue le {due_date}. Consultez les détails ici : {link}', 'Bonjour {first_name} 👋.

Nous souhaitons attirer votre attention sur le fait que la date d''échéance pour {account_name} est prévue pour le {due_date}.

Vous pouvez consulter les détails de votre facture ici : {link}

Cordialement,
L''équipe {account_name}', 'Notification : Échéance à venir pour {account_name}', '<table width="100%" cellpadding="0" cellspacing="0" dir="ltr" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: left; font-family: Arial, sans-serif;">
  <tbody>
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">
          Bonjour <strong>{first_name}</strong>,
        </p>
        
        <p style="font-size: 15px; margin-bottom: 15px; line-height: 1.6;">
          Nous souhaitons attirer votre attention sur le fait que la date d''échéance pour 
          <strong>{account_name}</strong> est prévue pour le <strong>{due_date}</strong>.
        </p>

        <p style="font-size: 15px; margin-bottom: 25px; line-height: 1.6;">
          Vous pouvez consulter les détails complets de votre facture et les informations de facturation via le lien ci-dessous :
        </p>

        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Consulter la facture
          </a>
        </p>

        <p style="font-size: 15px; margin-bottom: 20px; color: #666666;">
          Si vous avez des questions ou si vous avez besoin de précisions, notre équipe est à votre entière disposition.
        </p>

        <p style="font-size: 15px;">
          Cordialement,<br>
          <strong>L''équipe {account_name}</strong>
        </p>
      </td>
    </tr>
  </tbody>
</table>', 'cm4jv3d130002w6tkphqo0f3l', 'cm4jv3d130002w6tkphqo0f3l'),
  ('2026-02-25 06:51:38.797+02'::timestamptz, '2026-02-25 06:51:38.797+02'::timestamptz, 'Italian', 'Gentile {first_name}, Desideriamo informarLa che la scadenza per {account_name} è prevista per il {due_date}. Consulti i dettagli qui: {link}', 'Gentile {first_name} 👋.

Desideriamo informarLa che la data di scadenza per {account_name} è prevista per il {due_date}.

Può consultare i dettagli della fattura qui: {link}

Cordiali saluti,
Il team di {account_name}', 'Promemoria: Prossima scadenza per {account_name}', '<table width="100%" cellpadding="0" cellspacing="0" dir="ltr" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: left; font-family: Arial, sans-serif;">
  <tbody>
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">
          Gentile <strong>{first_name}</strong>,
        </p>
        
        <p style="font-size: 15px; margin-bottom: 15px; line-height: 1.6;">
          Desideriamo informarLa che la data di scadenza per 
          <strong>{account_name}</strong> è prevista per il <strong>{due_date}</strong>.
        </p>

        <p style="font-size: 15px; margin-bottom: 25px; line-height: 1.6;">
          Può consultare i dettagli completi della fattura e le informazioni di fatturazione tramite il link sottostante:
        </p>

        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Visualizza dettagli fattura
          </a>
        </p>

        <p style="font-size: 15px; margin-bottom: 20px; color: #666666;">
          In caso di domande o se necessita di ulteriori chiarimenti, il nostro team è a Sua completa disposizione.
        </p>

        <p style="font-size: 15px;">
          Cordiali saluti,<br>
          <strong>Il team di {account_name}</strong>
        </p>
      </td>
    </tr>
  </tbody>
</table>', 'cm4jv3d130002w6tkphqo0f3l', 'cm4jv3d130002w6tkphqo0f3l'),
  ('2026-02-25 06:51:38.798+02'::timestamptz, '2026-02-25 06:51:38.798+02'::timestamptz, 'Portuguese', 'Olá {first_name}, informamos que a data de vencimento para {account_name} é {due_date}. Veja os detalhes aqui: {link}', 'Olá {first_name} 👋.

Gostaríamos de informar que a data de vencimento para {account_name} está agendada para {due_date}.

Você pode revisar os detalhes da sua fatura aqui: {link}

Atenciosamente,
A equipe {account_name}', 'Lembrete: Próxima data de vencimento de {account_name}', '<table width="100%" cellpadding="0" cellspacing="0" dir="ltr" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: left; font-family: Arial, sans-serif;">
  <tbody>
    <tr>
      <td style="padding: 30px;">
        <p style="font-size: 16px; margin-bottom: 20px;">
          Olá <strong>{first_name}</strong>,
        </p>
        
        <p style="font-size: 15px; margin-bottom: 15px; line-height: 1.6;">
          Gostaríamos de informar que a data de vencimento para 
          <strong>{account_name}</strong> está agendada para <strong>{due_date}</strong>.
        </p>

        <p style="font-size: 15px; margin-bottom: 25px; line-height: 1.6;">
          Você pode revisar os detalhes completos da sua fatura e as informações de cobrança através do link abaixo:
        </p>

        <p style="text-align: center; margin-bottom: 30px;">
          <a href="{link}" style="background-color: #4a90e2; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 5px; display: inline-block; font-weight: bold;">
            Visualizar Detalhes da Fatura
          </a>
        </p>

        <p style="font-size: 15px; margin-bottom: 20px; color: #666666;">
          Caso tenha alguma dúvida ou precise de mais informações, nossa equipe está à sua disposição.
        </p>

        <p style="font-size: 15px;">
          Atenciosamente,<br>
          <strong>A equipe {account_name}</strong>
        </p>
      </td>
    </tr>
  </tbody>
</table>', 'cm4jv3d130002w6tkphqo0f3l', 'cm4jv3d130002w6tkphqo0f3l')
)
INSERT INTO "ActivityTemplateLanguage" (created_at, modified_at, template_id, language, sms_content, whatsapp_content, email_subject, email_content, account_id, created_by, modified_by)
SELECT ld.created_at, ld.modified_at, nt.id, ld.language, ld.sms_content, ld.whatsapp_content, ld.email_subject, ld.email_content, nt.account_id, ld.created_by, ld.modified_by
FROM new_templates nt
CROSS JOIN lang_data ld
;

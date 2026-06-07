import { RowDataPacket } from "mysql2";
import { createAdminNotification, notifyAdmins } from "../services/notificationService";
import { notifyPromotionStarted } from "../services/priceDropNotificationService";
import { runPropertyQuery } from "../services/propertyPersistenceService";

export async function runPropertyCreationPostPersistEffects(params: {
  flow: "broker" | "client";
  propertyId: number;
  title: unknown;
  promotionFlag: 0 | 1;
  promotionPercentage: number | null;
  ownerPhone: unknown;
  ownerName: unknown;
  actorId: number;
}): Promise<void> {
  const {
    flow,
    propertyId,
    title,
    promotionFlag,
    promotionPercentage,
    ownerPhone,
    ownerName,
    actorId,
  } = params;

  if (promotionFlag === 1) {
    try {
      await notifyPromotionStarted({
        propertyId,
        propertyTitle: String(title),
        promotionPercentage,
      });
    } catch (promotionNotifyError) {
      console.error(`Erro ao notificar favoritos sobre promocao (${flow} create):`, promotionNotifyError);
    }
  }

  if (flow === "broker") {
    try {
      await notifyAdmins(
        `Um novo imóvel '${title}' foi adicionado e aguarda aprovação.`,
        "property",
        propertyId
      );
    } catch (notifyError) {
      console.error("Erro ao enviar notificação aos administradores:", notifyError);
    }
    return;
  }

  try {
    const ownerPhoneDigits = String(ownerPhone ?? "").replace(/\D/g, "");
    const localPhoneDigits =
      ownerPhoneDigits.length >= 10 && ownerPhoneDigits.length <= 13 ? ownerPhoneDigits : null;
    let clientEmail: string | null = null;
    try {
      const emailRows = await runPropertyQuery<RowDataPacket[]>(
        "SELECT email FROM users WHERE id = ? LIMIT 1",
        [actorId]
      );
      const rawEmail = String(emailRows?.[0]?.email ?? "").trim();
      clientEmail = rawEmail || null;
    } catch (emailError) {
      console.error("Falha ao carregar e-mail do cliente para notificação de anúncio:", emailError);
    }
    const whatsappDigits = localPhoneDigits
      ? localPhoneDigits.startsWith("55")
        ? localPhoneDigits
        : `55${localPhoneDigits}`
      : null;
    const whatsappUrl = whatsappDigits ? `https://wa.me/${whatsappDigits}` : null;

    await createAdminNotification({
      type: "property",
      title: "Aviso: cliente tentou anunciar imóvel",
      message: `Novo imóvel enviado por cliente: '${title}'.`,
      relatedEntityId: propertyId,
      metadata: {
        source: "client_property_create",
        propertyId,
        propertyTitle: title,
        clientId: actorId,
        clientName: ownerName ?? null,
        clientEmail,
        clientPhoneRaw: String(ownerPhone ?? "").trim() || null,
        clientPhone: localPhoneDigits,
        whatsappUrl,
      },
    });
  } catch (notifyError) {
    console.error("Erro ao notificar admins sobre imovel de cliente:", notifyError);
  }
}

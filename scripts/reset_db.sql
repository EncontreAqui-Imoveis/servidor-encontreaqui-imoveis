-- ATENCAO: este script APAGA TODOS OS DADOS.
-- Use apenas apos backup.

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE `agencies`;
TRUNCATE TABLE `audit_logs`;
TRUNCATE TABLE `broker_documents`;
TRUNCATE TABLE `brokers`;
TRUNCATE TABLE `commissions`;
TRUNCATE TABLE `contracts`;
TRUNCATE TABLE `email_code_challenges`;
TRUNCATE TABLE `email_verification_requests`;
TRUNCATE TABLE `favoritos`;
TRUNCATE TABLE `featured_properties`;
TRUNCATE TABLE `negotiation_documents`;
TRUNCATE TABLE `negotiation_history`;
TRUNCATE TABLE `negotiation_proposal_idempotency`;
TRUNCATE TABLE `negotiations`;
TRUNCATE TABLE `notifications`;
TRUNCATE TABLE `password_reset_tokens`;
TRUNCATE TABLE `properties`;
TRUNCATE TABLE `property_edit_requests`;
TRUNCATE TABLE `property_images`;
TRUNCATE TABLE `sales`;
TRUNCATE TABLE `sre_external_services`;
TRUNCATE TABLE `sre_metrics_history`;
TRUNCATE TABLE `sre_releases`;
TRUNCATE TABLE `support_requests`;
TRUNCATE TABLE `user_device_tokens`;
TRUNCATE TABLE `users`;

SET FOREIGN_KEY_CHECKS = 1;

-- Seed admin
INSERT INTO admins (name, email, password_hash, role)
VALUES (
  'Admin EncontreAqui',
  'encontreaquiimoveisapp@gmail.com',
  '$2a$08$1WyqcC1u2Uf.ibhVo2D.6.FfAZ9JHmvOSHsQbYbt1jOGtRO3n/dXC',
  'admin'
);


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `role` varchar(50) COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'admin',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `token_version` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agencies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `logo_url` varchar(255) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `website` varchar(255) DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_agencies_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `firebase_uid` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `email_verified_at` datetime DEFAULT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `city` varchar(100) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `state` varchar(50) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `street` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `number` varchar(20) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `complement` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `bairro` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `cep` varchar(20) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `token_version` int NOT NULL DEFAULT '1',
  `cpf` varchar(20) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `firebase_uid` (`firebase_uid`),
  KEY `idx_users_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `brokers` (
  `id` int NOT NULL,
  `creci` varchar(8) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `status` enum('pending_verification','approved','rejected') COLLATE utf8mb4_0900_ai_ci DEFAULT 'pending_verification',
  `profile_type` enum('BROKER','AUXILIARY_ADMINISTRATIVE') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'BROKER',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `agency_id` int DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `fk_agency` (`agency_id`),
  UNIQUE KEY `uk_brokers_creci` (`creci`),
  CONSTRAINT `brokers_ibfk_1` FOREIGN KEY (`id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_agency` FOREIGN KEY (`agency_id`) REFERENCES `agencies` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `properties` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `description` text COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `type` varchar(100) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `status` enum('pending_approval','approved','rejected','rented','sold','negociacao') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'pending_approval',
  `purpose` enum('Venda','Aluguel','Venda e Aluguel') COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `market_stage` enum('STANDARD','LAUNCH') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'STANDARD',
  `price` decimal(12,2) NOT NULL,
  `address` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `city` varchar(100) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `state` varchar(50) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `bedrooms` int DEFAULT NULL,
  `bathrooms` int DEFAULT NULL,
  `area_construida` decimal(12,2) DEFAULT NULL,
  `garage_spots` int DEFAULT '0',
  `has_wifi` tinyint(1) DEFAULT '0',
  `video_url` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `broker_id` int DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `bairro` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `sale_value` decimal(12,2) DEFAULT NULL,
  `commission_value` decimal(12,2) DEFAULT NULL,
  `commission_rate` decimal(5,2) DEFAULT NULL,
  `code` varchar(10) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `quadra` varchar(100) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `lote` varchar(100) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `numero` varchar(20) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `complemento` text COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `area_terreno` decimal(12,2) DEFAULT NULL,
  `tem_piscina` tinyint(1) NOT NULL DEFAULT '0',
  `tem_energia_solar` tinyint(1) NOT NULL DEFAULT '0',
  `tem_automacao` tinyint(1) NOT NULL DEFAULT '0',
  `tem_ar_condicionado` tinyint(1) NOT NULL DEFAULT '0',
  `eh_mobiliada` tinyint(1) NOT NULL DEFAULT '0',
  `valor_condominio` decimal(12,2) DEFAULT NULL,
  `valor_iptu` decimal(12,2) DEFAULT NULL,
  `price_sale` decimal(12,2) DEFAULT NULL,
  `price_rent` decimal(12,2) DEFAULT NULL,
  `owner_id` int DEFAULT NULL,
  `owner_name` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `owner_phone` varchar(50) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `cep` varchar(20) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `sem_cep` tinyint(1) NOT NULL DEFAULT '0',
  `is_promoted` tinyint(1) NOT NULL DEFAULT '0',
  `promotion_percentage` decimal(5,2) DEFAULT NULL,
  `promotion_start` datetime DEFAULT NULL,
  `promotion_end` datetime DEFAULT NULL,
  `promo_percentage` decimal(5,2) DEFAULT NULL,
  `promo_start_date` date DEFAULT NULL,
  `promo_end_date` date DEFAULT NULL,
  `sem_numero` tinyint(1) NOT NULL DEFAULT '0',
  `visibility` enum('PUBLIC','HIDDEN') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'PUBLIC',
  `lifecycle_status` enum('AVAILABLE','SOLD','RENTED') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'AVAILABLE',
  `promotion_price` decimal(12,2) DEFAULT NULL,
  `promotional_rent_price` decimal(12,2) DEFAULT NULL,
  `promotional_rent_percentage` decimal(5,2) DEFAULT NULL,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `area_construida_unidade` varchar(20) COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'm2',
  `sem_quadra` tinyint(1) NOT NULL DEFAULT '0',
  `sem_lote` tinyint(1) NOT NULL DEFAULT '0',
  `rejection_reason` text COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `amenities` json DEFAULT NULL,
  `public_id` char(36) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `public_code` char(6) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `area_construida_valor` decimal(18,4) DEFAULT NULL,
  `area_construida_m2` decimal(18,2) DEFAULT NULL,
  `area_terreno_valor` decimal(18,4) DEFAULT NULL,
  `area_terreno_unidade` varchar(20) COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'm2',
  `area_terreno_m2` decimal(18,2) DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `properties_ibfk_1` (`broker_id`),
  KEY `idx_properties_bairro` (`bairro`),
  KEY `idx_properties_status` (`status`),
  KEY `idx_properties_city_st` (`city`,`state`),
  KEY `fk_properties_owner` (`owner_id`),
  KEY `idx_properties_status_broker` (`status`,`broker_id`),
  KEY `idx_properties_promocao` (`is_promoted`,`promotion_start`,`promotion_end`),
  KEY `idx_properties_price` (`price`),
  KEY `idx_properties_type` (`type`),
  KEY `idx_properties_purpose` (`purpose`),
  KEY `idx_properties_created` (`created_at`),
  KEY `idx_properties_promoted` (`is_promoted`),
  UNIQUE KEY `idx_properties_public_id` (`public_id`),
  UNIQUE KEY `idx_properties_public_code` (`public_code`),
  KEY `idx_properties_market_stage_listing` (`market_stage`,`purpose`,`status`,`visibility`),
  CONSTRAINT `properties_ibfk_1` FOREIGN KEY (`broker_id`) REFERENCES `brokers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_properties_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `property_images` (
  `id` int NOT NULL AUTO_INCREMENT,
  `property_id` int NOT NULL,
  `image_url` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `property_id` (`property_id`),
  CONSTRAINT `property_images_ibfk_1` FOREIGN KEY (`property_id`) REFERENCES `properties` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `property_edit_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `property_id` int NOT NULL,
  `requester_user_id` int NOT NULL,
  `requester_role` enum('broker','client') NOT NULL,
  `status` enum('PENDING','APPROVED','REJECTED','PARTIALLY_APPROVED') NOT NULL DEFAULT 'PENDING',
  `before_json` json NOT NULL,
  `after_json` json NOT NULL,
  `diff_json` json NOT NULL,
  `field_reviews_json` json DEFAULT NULL,
  `review_reason` text DEFAULT NULL,
  `reviewed_by` int DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_property_edit_requests_property_status` (`property_id`,`status`),
  KEY `idx_property_edit_requests_status_created` (`status`,`created_at`),
  KEY `fk_2` (`requester_user_id`),
  KEY `fk_3` (`reviewed_by`),
  CONSTRAINT `fk_1` FOREIGN KEY (`property_id`) REFERENCES `properties` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_2` FOREIGN KEY (`requester_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_3` FOREIGN KEY (`reviewed_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `featured_properties` (
  `property_id` int NOT NULL,
  `scope` enum('sale','rent') NOT NULL DEFAULT 'sale',
  `position` int NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`property_id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `idx_featured_scope_position` (`scope`,`position`),
  CONSTRAINT `fk_featured_properties_property` FOREIGN KEY (`property_id`) REFERENCES `properties` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `property_id` int NOT NULL,
  `broker_id` int NOT NULL,
  `deal_type` enum('sale','rent') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'sale',
  `sale_price` decimal(10,2) NOT NULL,
  `commission_rate` decimal(5,2) NOT NULL DEFAULT '5.00',
  `commission_amount` decimal(10,2) NOT NULL,
  `iptu_value` decimal(12,2) DEFAULT NULL,
  `condominio_value` decimal(12,2) DEFAULT NULL,
  `is_recurring` tinyint(1) NOT NULL DEFAULT '0',
  `sale_date` timestamp DEFAULT CURRENT_TIMESTAMP,
  `commission_cycles` int NOT NULL DEFAULT '0',
  `recurrence_interval` enum('none','weekly','monthly','yearly') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'none',
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `property_id` (`property_id`),
  KEY `sales_ibfk_2` (`broker_id`),
  CONSTRAINT `sales_ibfk_1` FOREIGN KEY (`property_id`) REFERENCES `properties` (`id`) ON DELETE CASCADE,
  CONSTRAINT `sales_ibfk_2` FOREIGN KEY (`broker_id`) REFERENCES `brokers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `broker_documents` (
  `broker_id` int NOT NULL,
  `creci_front_url` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `creci_back_url` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `selfie_url` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_0900_ai_ci DEFAULT 'pending',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`broker_id`) /*T![clustered_index] CLUSTERED */,
  CONSTRAINT `broker_documents_ibfk_1` FOREIGN KEY (`broker_id`) REFERENCES `brokers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `message` text NOT NULL,
  `related_entity_type` enum('property','broker','agency','user','announcement','negotiation','other') NOT NULL,
  `related_entity_id` bigint unsigned DEFAULT NULL,
  `recipient_id` bigint unsigned DEFAULT NULL,
  `recipient_type` enum('admin','user') NOT NULL DEFAULT 'user',
  `recipient_role` enum('client','broker','admin') NOT NULL DEFAULT 'client',
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `title` varchar(255) DEFAULT NULL,
  `metadata_json` json DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_notifications_is_read` (`is_read`),
  KEY `idx_notifications_entity` (`related_entity_type`,`related_entity_id`),
  KEY `idx_recipient` (`recipient_id`),
  KEY `idx_notifications_recipient_type` (`recipient_type`,`recipient_id`),
  KEY `idx_notifications_role` (`recipient_role`),
  KEY `idx_notifications_recipient_read` (`recipient_id`,`is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `support_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_support_requests_user_created` (`user_id`,`created_at`),
  CONSTRAINT `fk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_hash` varchar(255) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `used_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_password_reset_user` (`user_id`),
  KEY `idx_password_reset_token` (`token_hash`),
  CONSTRAINT `fk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_device_tokens` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `fcm_token` varchar(255) NOT NULL,
  `platform` varchar(50) DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_user_device_tokens_user` (`user_id`),
  UNIQUE KEY `fcm_token` (`fcm_token`),
  CONSTRAINT `fk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `favoritos` (
  `usuario_id` int NOT NULL,
  `imovel_id` int NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`usuario_id`,`imovel_id`) /*T![clustered_index] CLUSTERED */,
  KEY `fk_favoritos_imovel` (`imovel_id`),
  KEY `idx_favoritos_property_user` (`imovel_id`,`usuario_id`),
  CONSTRAINT `favoritos_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `favoritos_ibfk_2` FOREIGN KEY (`imovel_id`) REFERENCES `properties` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(80) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `entity_id` int NOT NULL,
  `action` varchar(120) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `performed_by_user_id` int NOT NULL,
  `metadata_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_audit_entity` (`entity_type`,`entity_id`),
  KEY `idx_audit_action` (`action`),
  KEY `idx_audit_created_at` (`created_at`),
  KEY `fk_audit_user` (`performed_by_user_id`),
  CONSTRAINT `fk_audit_user` FOREIGN KEY (`performed_by_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `negotiations` (
  `id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `property_id` int NOT NULL,
  `capturing_broker_id` int NOT NULL,
  `selling_broker_id` int DEFAULT NULL,
  `proposer_id` int DEFAULT NULL,
  `advertiser_id` int DEFAULT NULL,
  `initiator_side` enum('buyer','seller') COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `legal_buyer_user_id` int DEFAULT NULL,
  `handshake_pin` char(64) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `handshake_status` enum('PENDING','VERIFIED','REJECTED') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'PENDING',
  `handshake_attempts` tinyint unsigned NOT NULL DEFAULT '0',
  `deal_type` enum('sale','rent') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'sale',
  `status` varchar(64) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `final_value` decimal(12,2) DEFAULT NULL,
  `payment_details` json DEFAULT NULL COMMENT 'Expected JSON: {"method":"MONEY|PERMUTATION|FINANCING|OTHER","amount":123.45,"details":{...}}',
  `proposal_validity_date` date DEFAULT NULL,
  `version` int NOT NULL DEFAULT '0',
  `client_name` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `last_draft_edit_at` datetime(3) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_negotiations_property` (`property_id`),
  KEY `idx_negotiations_status` (`status`),
  KEY `idx_negotiations_brokers` (`capturing_broker_id`,`selling_broker_id`),
  KEY `fk_negotiations_selling_broker` (`selling_broker_id`),
  KEY `fk_negotiations_proposer` (`proposer_id`),
  KEY `fk_negotiations_advertiser` (`advertiser_id`),
  KEY `idx_negotiations_proposer_created` (`proposer_id`,`created_at`),
  KEY `idx_negotiations_advertiser_property` (`advertiser_id`,`property_id`),
  KEY `idx_negotiations_proposer_property` (`proposer_id`,`property_id`,`created_at`),
  KEY `fk_negotiations_legal_buyer_user` (`legal_buyer_user_id`),
  KEY `idx_negotiations_legal_buyer_created` (`legal_buyer_user_id`,`created_at`),
  CONSTRAINT `fk_negotiations_property` FOREIGN KEY (`property_id`) REFERENCES `properties` (`id`),
  CONSTRAINT `fk_negotiations_capturing_broker` FOREIGN KEY (`capturing_broker_id`) REFERENCES `brokers` (`id`),
  CONSTRAINT `fk_negotiations_selling_broker` FOREIGN KEY (`selling_broker_id`) REFERENCES `brokers` (`id`),
  CONSTRAINT `fk_negotiations_proposer` FOREIGN KEY (`proposer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_negotiations_advertiser` FOREIGN KEY (`advertiser_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_negotiations_legal_buyer_user` FOREIGN KEY (`legal_buyer_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `negotiation_documents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `negotiation_id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `type` enum('proposal','contract','other') COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `document_type` enum('doc_identidade','doc_identidade_conjuge','comprovante_endereco','certidao_casamento_nascimento','certidao_inteiro_teor','certidao_onus_acoes','comprovante_renda','comprovante_garantia','seguro_incendio','dados_bancarios','contrato_minuta','contrato_assinado','comprovante_pagamento','boleto_vistoria','outro','cliente_cnh','cliente_identidade','cliente_cpf','cliente_outro_01','cliente_outro_02','cliente_outro_03','cliente_outro_04','cliente_outro_05','cliente_outro_06','cliente_outro_07','cliente_outro_08','cliente_outro_09','cliente_outro_10','cliente_outro_11','cliente_outro_12','cliente_outro_13','cliente_outro_14','cliente_outro_15','cliente_outro_16','cliente_outro_17','cliente_outro_18','cliente_outro_19','cliente_outro_20') COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `metadata_json` json DEFAULT NULL,
  `file_content` longblob DEFAULT NULL,
  `storage_provider` varchar(32) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `storage_bucket` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `storage_key` varchar(1024) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `storage_content_type` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `storage_size_bytes` bigint DEFAULT NULL,
  `storage_etag` varchar(255) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_negotiation_documents_negotiation` (`negotiation_id`),
  KEY `idx_negotiation_documents_type_created` (`type`,`created_at`),
  CONSTRAINT `fk_negotiation_documents_negotiation` FOREIGN KEY (`negotiation_id`) REFERENCES `negotiations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `negotiation_history` (
  `id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `negotiation_id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `from_status` varchar(50) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `to_status` varchar(50) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `actor_id` int DEFAULT NULL,
  `metadata_json` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_hist_negotiation` (`negotiation_id`),
  KEY `fk_hist_actor` (`actor_id`),
  CONSTRAINT `fk_hist_negotiation` FOREIGN KEY (`negotiation_id`) REFERENCES `negotiations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hist_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `negotiation_responsibles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `negotiation_id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `user_id` int NOT NULL,
  `assigned_by` int DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_negotiation_responsibles_pair` (`negotiation_id`,`user_id`),
  KEY `idx_negotiation_responsibles_negotiation` (`negotiation_id`),
  KEY `idx_negotiation_responsibles_user` (`user_id`),
  KEY `fk_negotiation_responsibles_assigned_by` (`assigned_by`),
  CONSTRAINT `fk_negotiation_responsibles_negotiation` FOREIGN KEY (`negotiation_id`) REFERENCES `negotiations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_negotiation_responsibles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_negotiation_responsibles_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `admins` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `commissions` (
  `id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `negotiation_id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `broker_id` int NOT NULL,
  `role` enum('CAPTURING','SELLING') COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `status` enum('PENDING','PAID','CANCELLED') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'PENDING',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_commission_role` (`negotiation_id`,`broker_id`,`role`),
  KEY `idx_commissions_negotiation` (`negotiation_id`),
  KEY `idx_commissions_broker` (`broker_id`),
  KEY `idx_commissions_status` (`status`),
  CONSTRAINT `fk_commissions_negotiation` FOREIGN KEY (`negotiation_id`) REFERENCES `negotiations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_commissions_broker` FOREIGN KEY (`broker_id`) REFERENCES `brokers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contracts` (
  `id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `negotiation_id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `property_id` int NOT NULL,
  `deal_type` enum('sale','rent') COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `status` enum('AWAITING_DOCS','IN_DRAFT','AWAITING_SIGNATURES','FINALIZED','CANCELLED') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'AWAITING_DOCS',
  `seller_info` json DEFAULT NULL,
  `buyer_info` json DEFAULT NULL,
  `commission_data` json DEFAULT NULL,
  `workflow_metadata` json DEFAULT NULL,
  `seller_approval_status` enum('PENDING','APPROVED','APPROVED_WITH_RES','REJECTED') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'PENDING',
  `buyer_approval_status` enum('PENDING','APPROVED','APPROVED_WITH_RES','REJECTED') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'PENDING',
  `seller_approval_reason` json DEFAULT NULL,
  `buyer_approval_reason` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `finalized_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_contracts_negotiation` (`negotiation_id`),
  KEY `idx_contracts_property` (`property_id`),
  KEY `idx_contracts_status` (`status`),
  KEY `idx_contracts_deal_type_status` (`deal_type`,`status`),
  CONSTRAINT `fk_contracts_negotiation` FOREIGN KEY (`negotiation_id`) REFERENCES `negotiations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contracts_property` FOREIGN KEY (`property_id`) REFERENCES `properties` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contract_commission_allocations` (
  `id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `contract_id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `negotiation_id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `broker_id` int NOT NULL,
  `role` enum('CAPTURING','SELLING') COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `deal_type` enum('sale','rent') COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `base_amount` decimal(15,2) NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `status` enum('RECORDED','CANCELLED') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'RECORDED',
  `finalized_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_contract_commission_allocations_contract_broker_role` (`contract_id`,`broker_id`,`role`),
  KEY `idx_contract_commission_allocations_broker_finalized` (`broker_id`,`finalized_at`),
  KEY `idx_contract_commission_allocations_contract` (`contract_id`),
  KEY `fk_contract_commission_allocations_negotiation` (`negotiation_id`),
  CONSTRAINT `fk_contract_commission_allocations_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contract_commission_allocations_negotiation` FOREIGN KEY (`negotiation_id`) REFERENCES `negotiations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contract_document_rejections` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `contract_id` char(36) NOT NULL,
  `negotiation_id` char(36) NOT NULL,
  `source_document_id` bigint unsigned DEFAULT NULL,
  `document_type` varchar(128) DEFAULT NULL,
  `document_label` varchar(255) DEFAULT NULL,
  `original_file_name` varchar(512) DEFAULT NULL,
  `owner_side` enum('seller','buyer') DEFAULT NULL,
  `reason` text NOT NULL,
  `uploaded_by_user_id` int DEFAULT NULL,
  `rejected_by_admin_id` int DEFAULT NULL,
  `rejected_at` datetime NOT NULL,
  `legacy_audit_key` varchar(191) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_contract_document_rejections_legacy_audit` (`legacy_audit_key`),
  KEY `idx_contract_document_rejections_contract_date` (`contract_id`,`rejected_at`),
  KEY `idx_contract_document_rejections_negotiation_date` (`negotiation_id`,`rejected_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `negotiation_document_deletion_jobs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `negotiation_document_id` bigint DEFAULT NULL,
  `negotiation_id` char(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `document_type` varchar(64) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `storage_provider` varchar(32) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `storage_bucket` varchar(255) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `storage_key` varchar(1024) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `storage_key_hash` char(64) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `requested_by_user_id` int DEFAULT NULL,
  `request_source` varchar(64) COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `status` enum('PENDING','PROCESSING','DONE','FAILED') COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'PENDING',
  `attempts` int NOT NULL DEFAULT '0',
  `last_error` text COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `available_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_negotiation_document_deletion_jobs_storage_key_hash` (`storage_key_hash`),
  KEY `idx_negotiation_document_deletion_jobs_status_available` (`status`,`available_at`,`id`),
  KEY `idx_negotiation_document_deletion_jobs_negotiation` (`negotiation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_verification_requests` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `attempt_number` int NOT NULL,
  `cooldown_seconds` int NOT NULL,
  `expires_at` datetime NOT NULL,
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('sent','verified','expired') NOT NULL DEFAULT 'sent',
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_email_verification_email_sent_at` (`email`,`sent_at`),
  KEY `idx_email_verification_user_sent_at` (`user_id`,`sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `negotiation_proposal_idempotency` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `idempotency_key` varchar(128) NOT NULL,
  `negotiation_id` char(36) DEFAULT NULL,
  `document_id` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_negotiation_proposal_idempotency_user_key` (`user_id`,`idempotency_key`),
  KEY `idx_negotiation_proposal_idempotency_negotiation` (`negotiation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `registration_drafts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `draft_id` char(36) NOT NULL,
  `draft_token_hash` char(64) NOT NULL,
  `status` enum('OPEN','COMPLETED','DISCARDED','EXPIRED') NOT NULL DEFAULT 'OPEN',
  `profile_type` enum('client','broker') NOT NULL DEFAULT 'client',
  `email` varchar(255) NOT NULL,
  `email_normalized` varchar(255) GENERATED ALWAYS AS (lower(trim(`email`))) STORED,
  `name` varchar(255) DEFAULT NULL,
  `phone` varchar(25) DEFAULT NULL,
  `street` varchar(255) DEFAULT NULL,
  `number` varchar(50) DEFAULT NULL,
  `complement` varchar(255) DEFAULT NULL,
  `bairro` varchar(255) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(2) DEFAULT NULL,
  `cep` varchar(20) DEFAULT NULL,
  `without_number` tinyint(1) NOT NULL DEFAULT '0',
  `creci` varchar(8) DEFAULT NULL,
  `auth_provider` enum('email','google','firebase') NOT NULL DEFAULT 'email',
  `google_uid` varchar(128) DEFAULT NULL,
  `firebase_uid` varchar(128) DEFAULT NULL,
  `provider_aud` varchar(255) DEFAULT NULL,
  `provider_metadata` json DEFAULT NULL,
  `email_verified_at` datetime DEFAULT NULL,
  `phone_verified_at` datetime DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `password_hash_expires_at` datetime DEFAULT NULL,
  `current_step` enum('IDENTITY','CONTACT','ADDRESS','VERIFICATION','FINALIZE_CHOICE','FINALIZE_READY','DONE') NOT NULL DEFAULT 'IDENTITY',
  `revision` int NOT NULL DEFAULT '1',
  `expires_at` datetime NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  `discarded_at` datetime DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `active_email` varchar(255) GENERATED ALWAYS AS (case when `status` = _utf8mb4'OPEN' then `email_normalized` else null end) STORED,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_registration_drafts_draft_id` (`draft_id`),
  UNIQUE KEY `uq_registration_drafts_draft_token_hash` (`draft_token_hash`),
  UNIQUE KEY `uq_registration_drafts_open_email` (`active_email`),
  KEY `idx_registration_drafts_status` (`status`),
  KEY `idx_registration_drafts_profile` (`profile_type`),
  KEY `idx_registration_drafts_expires_at` (`expires_at`),
  KEY `idx_registration_drafts_user_id` (`user_id`),
  KEY `idx_registration_drafts_google_uid` (`google_uid`),
  KEY `idx_registration_drafts_firebase_uid` (`firebase_uid`),
  CONSTRAINT `fk_registration_drafts_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `registration_phone_otps` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `draft_id` bigint unsigned NOT NULL,
  `phone` varchar(25) NOT NULL,
  `session_token` char(36) NOT NULL,
  `code_hash` char(64) NOT NULL,
  `attempts` smallint unsigned NOT NULL DEFAULT '0',
  `max_attempts` smallint unsigned NOT NULL DEFAULT '5',
  `cooldown_seconds` smallint unsigned NOT NULL DEFAULT '60',
  `sent_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NOT NULL,
  `consumed_at` datetime DEFAULT NULL,
  `invalidated` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_registration_phone_otps_draft` (`draft_id`,`invalidated`,`consumed_at`),
  KEY `idx_registration_phone_otps_phone` (`phone`,`sent_at`),
  UNIQUE KEY `uq_registration_phone_otps_session` (`session_token`),
  CONSTRAINT `fk_registration_phone_otps_draft` FOREIGN KEY (`draft_id`) REFERENCES `registration_drafts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `registration_draft_documents` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `draft_id` bigint unsigned NOT NULL,
  `creci_front_url` varchar(1024) NOT NULL,
  `creci_back_url` varchar(1024) NOT NULL,
  `selfie_url` varchar(1024) NOT NULL,
  `status` enum('UPLOADED','PENDING','INVALID') NOT NULL DEFAULT 'UPLOADED',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_registration_draft_documents_draft` (`draft_id`),
  CONSTRAINT `fk_registration_draft_documents_draft` FOREIGN KEY (`draft_id`) REFERENCES `registration_drafts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_code_challenges` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `purpose` enum('verify_email','password_reset') NOT NULL,
  `code_hash` char(64) NOT NULL,
  `send_attempt_number` int NOT NULL,
  `failed_attempts` int NOT NULL DEFAULT '0',
  `max_attempts` int NOT NULL DEFAULT '5',
  `cooldown_seconds` int NOT NULL,
  `expires_at` datetime NOT NULL,
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `delivery_provider` varchar(32) NOT NULL DEFAULT 'brevo',
  `status` enum('sent','verified','consumed','expired','locked') NOT NULL DEFAULT 'sent',
  `verified_at` datetime DEFAULT NULL,
  `consumed_at` datetime DEFAULT NULL,
  `session_token_hash` char(64) DEFAULT NULL,
  `session_expires_at` datetime DEFAULT NULL,
  `draft_id` bigint unsigned DEFAULT NULL,
  `draft_token_hash` char(64) DEFAULT NULL,
  `draft_step` int DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_email_code_challenges_email_purpose_sent_at` (`email`,`purpose`,`sent_at`),
  KEY `idx_email_code_challenges_user_purpose_sent_at` (`user_id`,`purpose`,`sent_at`),
  KEY `idx_email_code_challenges_status_expires_at` (`status`,`expires_at`),
  KEY `idx_email_code_challenges_draft` (`draft_id`,`purpose`,`status`,`sent_at`),
  CONSTRAINT `fk_email_code_challenges_draft` FOREIGN KEY (`draft_id`) REFERENCES `registration_drafts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_legal_acceptances` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `type` enum('terms','privacy','broker_agreement') NOT NULL,
  `version` varchar(64) NOT NULL,
  `accepted_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_user_legal_acceptances_user_type_version` (`user_id`,`type`,`version`),
  KEY `idx_user_legal_acceptances_user_id` (`user_id`),
  KEY `idx_user_legal_acceptances_type` (`type`),
  KEY `idx_user_legal_acceptances_accepted_at` (`accepted_at`),
  CONSTRAINT `fk_user_legal_acceptances_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_phone_otps` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `phone` varchar(25) NOT NULL,
  `session_token` char(36) NOT NULL,
  `code_hash` char(64) NOT NULL,
  `attempts` smallint unsigned NOT NULL DEFAULT '0',
  `max_attempts` smallint unsigned NOT NULL DEFAULT '5',
  `cooldown_seconds` smallint unsigned NOT NULL DEFAULT '60',
  `sent_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_auth_phone_otps_session` (`session_token`),
  KEY `idx_auth_phone_otps_phone` (`phone`,`sent_at`),
  KEY `idx_auth_phone_otps_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `location_cities` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `state` varchar(2) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `normalized_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_location_cities_normalized_name_state` (`normalized_name`,`state`),
  KEY `idx_location_cities_search` (`normalized_name`,`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `location_neighborhoods` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `city_id` int unsigned NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `normalized_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `uq_location_neighborhoods_city_normalized_name` (`city_id`,`normalized_name`),
  KEY `idx_location_neighborhoods_search` (`city_id`,`normalized_name`),
  CONSTRAINT `fk_location_neighborhoods_city` FOREIGN KEY (`city_id`) REFERENCES `location_cities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sre_external_services` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `provider` varchar(255) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'operational',
  `latency` varchar(50) DEFAULT NULL,
  `cost` decimal(10,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `probe_url` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sre_releases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `platform` varchar(50) NOT NULL,
  `repo` varchar(255) NOT NULL,
  `version` varchar(50) NOT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'success',
  `impact` text DEFAULT NULL,
  `applied_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sre_metrics_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `metric_name` varchar(50) NOT NULL,
  `value` double NOT NULL,
  `timestamp` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) /*T![clustered_index] CLUSTERED */,
  KEY `idx_metric_time` (`metric_name`,`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


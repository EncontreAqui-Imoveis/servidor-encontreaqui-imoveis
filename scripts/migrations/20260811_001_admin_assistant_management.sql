-- Formaliza o ciclo de vida das contas auxiliares do painel.
-- IF NOT EXISTS evita falha em bancos que ja receberam parte do schema.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_by_admin_id INT NULL;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at DATETIME NULL;

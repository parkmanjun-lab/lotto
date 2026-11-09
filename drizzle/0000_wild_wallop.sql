CREATE TABLE `lotto_admin` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`password_hash` text NOT NULL,
	`credential_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "lotto_admin_single_owner" CHECK("lotto_admin"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `lotto_admin_csrf` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lotto_csrf_expiry` ON `lotto_admin_csrf` (`expires_at`);--> statement-breakpoint
CREATE TABLE `lotto_admin_rate` (
	`bucket` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lotto_rate_expiry` ON `lotto_admin_rate` (`expires_at`);--> statement-breakpoint
CREATE TABLE `lotto_admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lotto_sessions_expiry` ON `lotto_admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `lotto_sessions_user` ON `lotto_admin_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `lotto_visits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`visit_id` text NOT NULL,
	`ip` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lotto_visits_visit_id_unique` ON `lotto_visits` (`visit_id`);--> statement-breakpoint
CREATE INDEX `lotto_visits_at` ON `lotto_visits` (`at`);
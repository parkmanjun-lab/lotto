CREATE TABLE `lotto_deleted_records` (
	`id_hash` text NOT NULL,
	`proof_hash` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`id_hash`, `proof_hash`)
);
--> statement-breakpoint
CREATE TABLE `lotto_recommendation_rounds` (
	`target_round` integer PRIMARY KEY NOT NULL,
	`draw_json` text,
	`verified_at` integer,
	`batch_count` integer DEFAULT 0 NOT NULL,
	`combination_count` integer DEFAULT 0 NOT NULL,
	`pending` integer DEFAULT 0 NOT NULL,
	`deleted_unresolved` integer DEFAULT 0 NOT NULL,
	`losing` integer DEFAULT 0 NOT NULL,
	`rank1` integer DEFAULT 0 NOT NULL,
	`rank2` integer DEFAULT 0 NOT NULL,
	`rank3` integer DEFAULT 0 NOT NULL,
	`rank4` integer DEFAULT 0 NOT NULL,
	`rank5` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lotto_recommendation_rounds_total" CHECK("lotto_recommendation_rounds"."combination_count" = "lotto_recommendation_rounds"."pending" + "lotto_recommendation_rounds"."deleted_unresolved" + "lotto_recommendation_rounds"."losing" + "lotto_recommendation_rounds"."rank1" + "lotto_recommendation_rounds"."rank2" + "lotto_recommendation_rounds"."rank3" + "lotto_recommendation_rounds"."rank4" + "lotto_recommendation_rounds"."rank5")
);
--> statement-breakpoint
CREATE TABLE `lotto_recommendations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`delete_proof_hash` text NOT NULL,
	`combinations_json` text,
	`accepted_at` integer NOT NULL,
	`target_round` integer NOT NULL,
	`target_date` text NOT NULL,
	`cutoff_at` integer NOT NULL,
	`analysis_window` integer NOT NULL,
	`analyzed_round` integer NOT NULL,
	`app_version` text NOT NULL,
	`generation_method` text NOT NULL,
	`ip` text,
	`device` text,
	`os` text,
	`browser` text,
	`display_mode` text,
	`results_json` text,
	`draw_json` text,
	`settled_at` integer,
	`details_pruned` integer DEFAULT 0 NOT NULL,
	`losing_count` integer DEFAULT 0 NOT NULL,
	`rank1_count` integer DEFAULT 0 NOT NULL,
	`rank2_count` integer DEFAULT 0 NOT NULL,
	`rank3_count` integer DEFAULT 0 NOT NULL,
	`rank4_count` integer DEFAULT 0 NOT NULL,
	`rank5_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lotto_recommendations_numbers" CHECK(("lotto_recommendations"."combinations_json" IS NULL AND "lotto_recommendations"."details_pruned" = 1) OR (json_valid("lotto_recommendations"."combinations_json") AND json_type("lotto_recommendations"."combinations_json") = 'array' AND (("lotto_recommendations"."details_pruned" = 0 AND json_array_length("lotto_recommendations"."combinations_json") = 10) OR ("lotto_recommendations"."details_pruned" = 1 AND json_array_length("lotto_recommendations"."combinations_json") BETWEEN 1 AND 10)))),
	CONSTRAINT "lotto_recommendations_window" CHECK("lotto_recommendations"."analysis_window" IN (20, 50, 100)),
	CONSTRAINT "lotto_recommendations_target" CHECK("lotto_recommendations"."analyzed_round" > 0 AND "lotto_recommendations"."analyzed_round" < "lotto_recommendations"."target_round" AND "lotto_recommendations"."accepted_at" < "lotto_recommendations"."cutoff_at"),
	CONSTRAINT "lotto_recommendations_settlement" CHECK("lotto_recommendations"."settled_at" IS NULL OR "lotto_recommendations"."losing_count" + "lotto_recommendations"."rank1_count" + "lotto_recommendations"."rank2_count" + "lotto_recommendations"."rank3_count" + "lotto_recommendations"."rank4_count" + "lotto_recommendations"."rank5_count" = 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lotto_recommendations_batch_id_unique` ON `lotto_recommendations` (`batch_id`);--> statement-breakpoint
CREATE INDEX `lotto_recommendations_accepted` ON `lotto_recommendations` (`accepted_at`);--> statement-breakpoint
CREATE INDEX `lotto_recommendations_round_id` ON `lotto_recommendations` (`target_round`,`id`);--> statement-breakpoint
CREATE INDEX `lotto_recommendations_unsettled` ON `lotto_recommendations` (`settled_at`,`target_round`);--> statement-breakpoint
ALTER TABLE `lotto_visits` ADD `delete_proof_hash` text;--> statement-breakpoint
CREATE TRIGGER lotto_recommendations_count_acceptance AFTER INSERT ON lotto_recommendations
BEGIN
  INSERT INTO lotto_recommendation_rounds (target_round, batch_count, combination_count, pending)
  VALUES (NEW.target_round, 1, 10, 10)
  ON CONFLICT(target_round) DO UPDATE SET batch_count = batch_count + 1,
    combination_count = combination_count + 10, pending = pending + 10;
END;
--> statement-breakpoint
CREATE TRIGGER lotto_recommendations_count_settlement AFTER UPDATE OF settled_at ON lotto_recommendations
WHEN OLD.settled_at IS NULL AND NEW.settled_at IS NOT NULL
BEGIN
  UPDATE lotto_recommendation_rounds SET pending = pending - 10,
    losing = losing + NEW.losing_count, rank1 = rank1 + NEW.rank1_count,
    rank2 = rank2 + NEW.rank2_count, rank3 = rank3 + NEW.rank3_count,
    rank4 = rank4 + NEW.rank4_count, rank5 = rank5 + NEW.rank5_count
  WHERE target_round = NEW.target_round;
END;
--> statement-breakpoint
CREATE TRIGGER lotto_recommendations_count_unresolved_deletion AFTER DELETE ON lotto_recommendations
WHEN OLD.settled_at IS NULL
BEGIN
  UPDATE lotto_recommendation_rounds SET pending = pending - 10, deleted_unresolved = deleted_unresolved + 10
  WHERE target_round = OLD.target_round;
END;

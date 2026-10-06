-- MySQL schema backup; no user task/session/timer data included.
-- Restore into an empty database, then run pnpm db:migrate.
SET NAMES utf8mb4;

CREATE TABLE `abandoned_sessions` (
  `id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `abandoned_at` datetime(3) NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_abandoned_at` (`abandoned_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `app_state` (
  `id` tinyint unsigned NOT NULL,
  `revision` bigint unsigned NOT NULL DEFAULT '0',
  `timer` json DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_single_state` CHECK ((`id` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `schema_migrations` (
  `version` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `checksum` char(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `applied_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `sessions` (
  `id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `task_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `task_title` varchar(80) NOT NULL,
  `category` enum('工作','学习','生活') NOT NULL,
  `duration_minutes` double NOT NULL,
  `completed_at` datetime(3) NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_sessions_completed_at` (`completed_at`),
  KEY `idx_sessions_task_id` (`task_id`),
  CONSTRAINT `chk_session_duration` CHECK (((`duration_minutes` > 0) and (`duration_minutes` <= 10080)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tasks` (
  `id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `title` varchar(80) NOT NULL,
  `note` varchar(500) NOT NULL DEFAULT '',
  `category` enum('工作','学习','生活') NOT NULL,
  `estimated_pomodoros` int unsigned NOT NULL,
  `duration_minutes` int unsigned NOT NULL,
  `due_date` date DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  `theme` enum('sky','city','mint','violet') DEFAULT NULL,
  `kind` enum('pomodoro','goal','habit') DEFAULT NULL,
  `timing_mode` enum('countdown','countup','untimed') DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `idx_tasks_due_date` (`due_date`),
  KEY `idx_tasks_completed_at` (`completed_at`),
  CONSTRAINT `chk_task_duration` CHECK ((`duration_minutes` between 1 and 180)),
  CONSTRAINT `chk_task_estimate` CHECK ((`estimated_pomodoros` between 1 and 1000))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO app_state (id,revision,timer) VALUES (1,0,NULL);

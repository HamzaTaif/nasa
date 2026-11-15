CREATE TABLE `geocode_cache` (
  `key` text PRIMARY KEY NOT NULL,
  `results` text NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `geocode_gate` (
  `id` integer PRIMARY KEY NOT NULL,
  `token` text NOT NULL,
  `available_at` integer NOT NULL
);

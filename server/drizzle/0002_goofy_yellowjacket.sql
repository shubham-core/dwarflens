ALTER TABLE "orgs" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_stripe_customer_id_unique" UNIQUE("stripe_customer_id");
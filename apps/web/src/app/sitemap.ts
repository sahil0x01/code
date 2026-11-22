import type { MetadataRoute } from "next";
import { env } from "@/env";

const paths = ["/"];

export default function sitemap(): MetadataRoute.Sitemap {
	return paths.map((path) => ({
		url: `${env.NEXT_PUBLIC_APP_URL}${path}`,
	}));
}

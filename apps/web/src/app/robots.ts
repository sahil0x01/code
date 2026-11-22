import type { MetadataRoute } from "next";
import { env } from "@/env";
import { site } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
	const isProduction = env.NEXT_PUBLIC_APP_URL === site.productionUrl;

	if (!isProduction) {
		return { rules: { userAgent: "*", disallow: "/" } };
	}

	return {
		rules: { userAgent: "*", allow: "/" },
		sitemap: `${env.NEXT_PUBLIC_APP_URL}/sitemap.xml`,
	};
}

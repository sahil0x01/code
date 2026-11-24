import path from "node:path";
import type { NextConfig } from "next";

const standalone = process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = {
	...(standalone && {
		output: "standalone" as const,
		outputFileTracingRoot: path.join(process.cwd(), "../.."),
	}),
	cacheComponents: true,
	partialPrefetching: true,
	turbopack: {
		rules: {
			"*.css": {
				loaders: ["@tailwindcss/turbopack"],
				as: "*.css",
			},
		},
	},
};

export default nextConfig;

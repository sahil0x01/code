/** What a restricted sandbox may reach: code hosts and package registries. */
export const DEFAULT_ALLOWED_DOMAINS = [
	"github.com",
	"*.github.com",
	"*.githubusercontent.com",
	"*.npmjs.org",
	"registry.yarnpkg.com",
	"repo.yarnpkg.com",
	"nodejs.org",
	"pypi.org",
	"files.pythonhosted.org",
	"crates.io",
	"*.crates.io",
	"static.rust-lang.org",
	"proxy.golang.org",
	"sum.golang.org",
	"rubygems.org",
	"repo.maven.apache.org",
	"binaries.prisma.sh",
	"fonts.googleapis.com",
	"fonts.gstatic.com",
];

const DOMAIN = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/;

/** A comma-separated list of domains. Throws on anything else, so a typo is noticed. */
export function parseDomains(list: string) {
	return list
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean)
		.map((entry) => {
			if (!DOMAIN.test(entry)) throw new Error(`Not a domain name: ${entry}`);
			return entry;
		});
}

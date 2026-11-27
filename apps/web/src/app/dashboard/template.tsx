/** Fades each dashboard page in as it is opened. */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
	return <div className="fade">{children}</div>;
}

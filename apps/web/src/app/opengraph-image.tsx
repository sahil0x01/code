import { ImageResponse } from "next/og";

export const alt = "NullFuse Code: give it a task, get a pull request";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				background: "#fafafa",
				padding: 72,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 12,
					background: "#ffffff",
					border: "6px solid #0f0f0f",
					boxShadow: "16px 16px 0 0 #0f0f0f",
					padding: "56px 64px",
					fontSize: 92,
					fontWeight: 700,
					lineHeight: 1.05,
					letterSpacing: -3,
					color: "#0f0f0f",
				}}
			>
				<div style={{ display: "flex" }}>Give it a task.</div>
				<div style={{ display: "flex", alignItems: "center", gap: 24 }}>
					<span>Get a</span>
					<span style={{ background: "#f5d547", padding: "0 16px" }}>
						pull request
					</span>
				</div>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 16,
					fontSize: 36,
					color: "#0f0f0f",
				}}
			>
				<span style={{ fontWeight: 700 }}>NullFuse Code</span>
				<span style={{ color: "#6b6b6b" }}>Open-source cloud coding agent</span>
			</div>
		</div>,
		{ ...size },
	);
}

import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

const { fontFamily: sans } = loadGeist("normal", {
	weights: ["400", "600", "700"],
	subsets: ["latin"],
});
const { fontFamily: mono } = loadGeistMono("normal", {
	weights: ["400"],
	subsets: ["latin"],
});

export const FPS = 30;
export const DURATION_IN_FRAMES = 12 * FPS;

const INK = "#0f0f0f";
const BG = "#fafafa";
const SURFACE = "#ffffff";
const YELLOW = "#f5d547";
const MUTED = "#6b6b6b";
const RED = "#d23b2a";

// The story: signed in, session counts down, session expires, user is signed out.
const COUNTDOWN_START = 30;
const SECONDS_ON_DASHBOARD = 6;
const EXPIRED_AT = COUNTDOWN_START + SECONDS_ON_DASHBOARD * FPS;
const LOGIN_AT = EXPIRED_AT + 2 * FPS;
const TYPE_START = LOGIN_AT + 20;
const FRAMES_PER_CHAR = 3;
const EMAIL = "sam@acme.dev";

const card = {
	background: SURFACE,
	border: `4px solid ${INK}`,
	boxShadow: `10px 10px 0 0 ${INK}`,
	padding: "36px 44px",
	width: 600,
} as const;

function popIn(frame: number, from: number) {
	return interpolate(frame, [from, from + 6], [0.96, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
}

const Dashboard = ({ frame }: { frame: number }) => {
	const remaining = Math.max(
		0,
		SECONDS_ON_DASHBOARD - Math.floor((frame - COUNTDOWN_START) / FPS),
	);
	const urgent = remaining <= 2;

	return (
		<div style={{ ...card, scale: popIn(frame, 0) }}>
			<div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
				Dashboard
			</div>
			<div style={{ fontSize: 24, marginTop: 8 }}>Welcome back, Sam.</div>
			<div
				style={{
					marginTop: 28,
					display: "inline-flex",
					gap: 12,
					alignItems: "center",
					fontFamily: mono,
					fontSize: 22,
					padding: "8px 14px",
					border: `3px solid ${INK}`,
					background: urgent ? YELLOW : BG,
				}}
			>
				Session expires in {remaining}s
			</div>
			<div style={{ marginTop: 28, display: "grid", gap: 10 }}>
				{[70, 52, 62].map((width) => (
					<div
						key={width}
						style={{ height: 14, width: `${width}%`, background: "#e6e6e6" }}
					/>
				))}
			</div>
		</div>
	);
};

const Expired = ({ frame }: { frame: number }) => {
	const local = frame - EXPIRED_AT;
	return (
		<div style={{ ...card, scale: popIn(local, 0) }}>
			<div
				style={{
					fontSize: 40,
					fontWeight: 700,
					letterSpacing: -1,
					color: RED,
				}}
			>
				Session expired
			</div>
			<div style={{ fontSize: 24, marginTop: 12, color: MUTED }}>
				Signing you out
				{".".repeat(1 + (Math.floor(local / 10) % 3))}
			</div>
		</div>
	);
};

const SignIn = ({ frame }: { frame: number }) => {
	const local = frame - LOGIN_AT;
	const typed = EMAIL.slice(
		0,
		Math.max(
			0,
			Math.min(EMAIL.length, Math.floor((frame - TYPE_START) / FRAMES_PER_CHAR)),
		),
	);
	const caretOn = Math.floor(frame / 15) % 2 === 0;

	return (
		<div style={{ ...card, scale: popIn(local, 0) }}>
			<div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>
				Sign in
			</div>
			<div style={{ fontFamily: mono, fontSize: 16, color: MUTED, marginTop: 20 }}>
				EMAIL
			</div>
			<div
				style={{
					marginTop: 8,
					height: 52,
					border: `3px solid ${INK}`,
					background: BG,
					padding: "0 14px",
					display: "flex",
					alignItems: "center",
					fontFamily: mono,
					fontSize: 24,
				}}
			>
				{typed}
				<span
					style={{
						marginLeft: 2,
						width: 12,
						height: 28,
						background: caretOn ? INK : "transparent",
					}}
				/>
			</div>
			<div
				style={{
					marginTop: 24,
					display: "inline-block",
					padding: "12px 24px",
					border: `3px solid ${INK}`,
					background: YELLOW,
					fontSize: 22,
					fontWeight: 600,
				}}
			>
				Sign in
			</div>
		</div>
	);
};

export const VerificationDemo = () => {
	const frame = useCurrentFrame();

	return (
		<AbsoluteFill
			style={{ background: BG, color: INK, fontFamily: sans }}
		>
			<div
				style={{
					height: 64,
					borderBottom: `4px solid ${INK}`,
					display: "flex",
					alignItems: "center",
					padding: "0 32px",
					gap: 12,
					fontSize: 24,
					fontWeight: 700,
					background: SURFACE,
				}}
			>
				<div style={{ width: 22, height: 22, background: YELLOW, border: `3px solid ${INK}` }} />
				acme web-app
			</div>
			<AbsoluteFill
				style={{
					top: 64,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{frame < EXPIRED_AT && <Dashboard frame={frame} />}
				{frame >= EXPIRED_AT && frame < LOGIN_AT && <Expired frame={frame} />}
				{frame >= LOGIN_AT && <SignIn frame={frame} />}
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

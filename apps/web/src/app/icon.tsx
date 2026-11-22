import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				background: "#f5d547",
				border: "4px solid #0f0f0f",
			}}
		/>,
		{ ...size },
	);
}

import { Composition } from "remotion";
import { DURATION_IN_FRAMES, FPS, VerificationDemo } from "./VerificationDemo";

export const RemotionRoot = () => {
	return (
		<Composition
			id="VerificationDemo"
			component={VerificationDemo}
			durationInFrames={DURATION_IN_FRAMES}
			fps={FPS}
			width={960}
			height={540}
		/>
	);
};

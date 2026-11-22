"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AppWindow } from "./app-window";
import {
	ConnectScreen,
	ProjectsScreen,
	RunScreen,
	TaskScreen,
} from "./screens";
import { CYCLE_MS, FINAL_FRAME_MS, sceneAt } from "./timeline";

function subscribeToReducedMotion(onChange: () => void) {
	const query = window.matchMedia("(prefers-reduced-motion: reduce)");
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

function getReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getServerReducedMotion() {
	return false;
}

export function RunPreview() {
	const [time, setTime] = useState(0);
	const [paused, setPaused] = useState(false);
	const reducedMotion = useSyncExternalStore(
		subscribeToReducedMotion,
		getReducedMotion,
		getServerReducedMotion,
	);

	const playing = !reducedMotion && !paused;

	useEffect(() => {
		if (!playing) return;
		let last = performance.now();
		const id = setInterval(() => {
			const now = performance.now();
			const elapsed = now - last;
			last = now;
			setTime((previous) => (previous + elapsed) % CYCLE_MS);
		}, 50);
		return () => clearInterval(id);
	}, [playing]);

	const scene = sceneAt(reducedMotion ? FINAL_FRAME_MS : time);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-4">
				<p className="font-mono text-xs uppercase text-subtle">example run</p>
				{!reducedMotion && (
					<button
						type="button"
						onClick={() => setPaused((value) => !value)}
						className="pixel pressable inline-flex h-7 items-center bg-surface px-3 font-mono text-xs uppercase"
					>
						{paused ? "Play" : "Pause"}
					</button>
				)}
			</div>

			<p className="sr-only">
				An example of the app. You connect GitHub, create a task in plain
				language, and start a run. The agent reads the code, fixes the bug, runs
				the tests, checks the fix in a browser while recording a short video, and
				opens a pull request with the video attached. You see a notification when
				it is done.
			</p>

			<div aria-hidden="true">
				<AppWindow
					url={scene.url}
					activeNav={scene.nav}
					noticeShown={scene.noticeShown}
				>
					{scene.screen === "connect" && <ConnectScreen scene={scene} />}
					{scene.screen === "projects" && <ProjectsScreen scene={scene} />}
					{scene.screen === "task" && <TaskScreen scene={scene} />}
					{scene.screen === "run" && (
						<RunScreen scene={scene} playing={playing} />
					)}
				</AppWindow>
			</div>
		</div>
	);
}

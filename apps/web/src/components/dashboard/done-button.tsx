import { setDone } from "@/actions/chats";
import { buttonClass } from "@/components/ui/styles";

export function DoneButton({ chatId, done }: { chatId: string; done: boolean }) {
	return (
		<form action={setDone}>
			<input type="hidden" name="chatId" value={chatId} />
			<input type="hidden" name="done" value={String(!done)} />
			<button type="submit" className={buttonClass(done ? "secondary" : "primary", "sm")}>
				{done ? "Back to review" : "Mark done"}
			</button>
		</form>
	);
}

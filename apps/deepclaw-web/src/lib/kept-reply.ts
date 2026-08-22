/**
 * Keeps what a finished run leaves behind for the message it wrote, out of what the tab holds of it
 * and the text the run ended with.
 *
 * The chunks a stream was read in live nowhere but the tab until they are sent back, so what the
 * user read is what is kept. A run that streamed nothing leaves nothing there to send, and sending
 * that nothing would wipe the text the run ended with: a call turned away before it began says all
 * it has to say at once, which is a whole answer rather than a reply half written. A run with
 * nothing on either side is not written down at all, an empty message being how a run still
 * thinking is read.
 */
export function keepReply(
    held: string | undefined,
    streamed: string | undefined,
    keep: (text: string) => void,
): void {
    const text = held || streamed;
    if (text) {
        keep(text);
    }
}

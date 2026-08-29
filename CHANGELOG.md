v0.0.19
a project now waits for the start button on the board before any of its tasks is worked.
a small job is a project of one task now, there is no separate simple task.
an agent now says how the work feels while a subagent is working a task in its name.
a chat now keeps the whole of what a run wrote instead of the line it ended on.
a project already underway now takes a task the plan left out.
an agent's llm protocol can now be picked in the settings instead of being guessed from its url.
a project description can now be rewritten on the board.

v0.0.18
a chat transcript nobody has read or written in for a while is no longer held in memory either.
an answer written into a message already on the disk is now written to the file as well.
a chat asking to be caught up from a message the server cannot place now asks for the last page.
a task now runs on the model of the agent it was assigned to.
a conversation past twenty thousand messages or eight megabytes now says so in the log.

v0.0.17
a conversation is now summarized against what the model will take rather than a character count.
a refusal that names no size limit now leaves one behind all the same.
the call that shortens a long history now sends both ends of it rather than the whole.
a refusal for a history too long now leads to a summary and another try, not the end of the run.
a history in another model's shape no longer takes the run down before it can be migrated.
a session is no longer marked as having changed protocol by a compaction that failed to change it.
no sampling parameter is sent to the model any more.
a summary is asked for sooner, and a tool result cut down for one now keeps both ends.
the log files no longer pile up, fifty being kept.
the record of a scheduled task no longer grows without end.
a cron page shows twenty runs at a time rather than ten.
a project can be put away.
what can be done with a project as a whole now sits in a bar under its tasks.
the projects page no longer starts by loading every task of every project.
a page whose connection drops now catches up when it comes back.
opening a row a second time no longer asks after its tasks a second time.
a project put away while its tasks were still being read no longer comes back from the dead.
a chat cannot be written into until it has read itself.
an agent is now shown what it last said it felt, and asked about it once that has stood for a while.
praise and criticize are hidden, with the three dots on the agent header and the owner tooltip.
a conversation nobody has been in for a while no longer holds its history in memory.

v0.0.16
press stop and have a run end where it stands, rather than at the end of a turn.
a conversation moved to another kind of model is moved once and for good.
put a question left behind by a tab that closed to a tab that has the conversation open.
let a hook that throws take down nothing but itself.

v0.0.14
read a chat thirty messages to a page rather than ten, pulling until the panel overflows.
close a conversation and start the agent over from an empty context, and read back the closed ones.
call a conversation that was closed by what was first asked of it.
hold the name of a conversation asked for by a browser to being a timestamp.
leave a conversation that could not be filed away open, and say so.
carry no more of what a conversation ended with than the list of them shows.
let go of a conversation that was read back once the page of it is out.
keep an answer whole across a page the user walked off to in the middle of it.
hand back the whole of what a command printed rather than the first twenty thousand characters.
let a skill shipped with a release reach an install that has been here longer than it.
count what has been laid down beside the skills folder, so a skill the user removed stays removed.
offer a skill only in the modes it is any use in.
say what looking a skill up on disk costs instead of banning the shell for skills outright.
leave installing the browser cli to the user rather than opening the skill with a line that fails.
show the user a picture that was written to disk rather than the path it was written to.
read a command line the way the shell that runs it would before asking the user about it.
let a line of several commands through where every name in it is one nobody needs telling about.
put a background command through the same guard as one run in the foreground.

v0.0.13
hand a run only the tools it could have a use for, and tell it of no tool it was not handed.
say how a project went as a whole, and not only how each task of it went.
remove a skill by deleting the folder it was installed in, rather than by asking the installer to.
remove a skill from the skills page too, a bin at the end of its row asking first.
ask before deleting a scheduled task as well, by the same dialog.
hand a task to another agent from the card it stands on, while nobody has started it.
let a run put a question of its own and stand still until it is answered.
say of a saved language that a language was saved, the other fields of the form having gone nowhere.
let a notice of a loop be read once rather than said twice over.

v0.0.12
keep the answer of a run that never streamed a word, an error being what the chat comes back to.
store a language as it is picked, with no button in between.
let a long command in a question of a loop be read: it wraps and keeps the lines it was written in.
pin an added skill to the one folder deepclaw reads.

v0.0.11
make the toast of a waiting question the way back to it, a click opening the chat that asked.
put the modals above the toasts, and the question of a loop above the rest of them.
keep a granted permission on the loop, shared with every loop it spawns.
mount one agent layout at a time, and take a message told twice for the one message it is.

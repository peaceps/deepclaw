v0.0.17
a conversation is now summarized against what the model will actually take, rather than against a
count of characters. how many tokens a request came to is something the model says back on every
answer, and it is the only exact measure of a history there is: characters stand for tokens at four
to one in code and about one to one in chinese, so one number in characters was a third of a window
on one conversation and the whole of it on another, and a chinese conversation would run into the
limit long before anything here thought it was close. where the limit lies is not something any of
these apis will tell you, so it is learned from being refused: the number a refusal names is kept,
per agent, beside the model it was learned from, and read back at the start of every run. a call
that goes through is evidence too, of the other kind: it retires a limit the far end has since
raised, or one left behind by a config that has been pointed somewhere else, and it is what makes a
window findable at all. only a conversation that reaches the wall is ever refused, and the budget is
what stops one from reaching it, so a budget that never moved would hold a run at its opening guess
for good, whether the real window were that or twenty times it. every call that goes through proves
the window at least as wide as what it carried, and the next one is allowed a fifth more than that:
a climb, renewed each turn, settled the moment a refusal names the figure. before the first answer
of a run has been counted there is nothing exact to go on, and the guess is made in tokens rather
than in characters, read off the bytes at three to a token: utf-8 is a rough tokenizer wearing
another hat, spending on a script about what a tokenizer spends on it, so the guess means the same
thing in every language rather than being right in one and fourfold wrong in the next. it errs a
third high everywhere, which is the side to err on -- reading a history as smaller than it is means
the call meant to shorten it goes out too long anyway. a gateway that puts a limit on the bytes of a
request rather than on the tokens of a window is learned the same way and kept apart, being a
different thing measured differently.
a refusal that names no figure at all -- which is what an openai-compatible proxy in front of a
model tends to give, the words being there and the numbers not -- now leaves something behind all
the same, read off the largest call that has gone through, or off an estimate where none has. this
is the difference between a conversation that carries on and one that cannot be continued at all:
every way out of being refused for a history too long runs through a summary, and a summary of a
history there is no known limit to trim it against is a call refused for the very reason the last
one was. three of those and the run gives up, and the next thing said starts the same three over.
the call that shortens a history too long for the model used to send that history whole in one
message, which is a call too long for it as well. it now sends both ends of the conversation, as
much of each as the far end is known to take -- in bytes as well as in tokens, a gateway that
limits the one having said nothing about the other -- the full history still going to the archive
where it can be read back. both ends because the answer can be at either: the goal of a run and the
constraints of the user are stated once, at the start, and never again, and the step to take next is
at the end by definition. this is what a run needs at the exact moment it finds out how wide its
window is, that being the moment its history is at its widest.
being refused for a history too long now leads somewhere. it used to be read off the code beside the
refusal rather than the words of it, which works for the two apis that own those codes and for
nobody standing in front of them: a gateway calls an overflow the same thing it calls a malformed
request, so the one error the run could have recovered from was the one it died on. the words are
read now, and what follows a refusal is a summary and another try rather than the end of the run.
three refusals in a row and it gives up and says so -- that a conversation is too long for this
model and stayed too long after being summarized, which is a thing the user can do something about,
where before the reply to a question that got that far was the question itself handed back.
a history in another model's shape no longer takes the run down before it can be migrated. cutting
old tool results down to size is skipped for a conversation known to be outdated, and the anthropic
side of it reached into every message for a content field that a message of the two other protocols
need not have at all -- so where the shape had changed without being noticed, the turn that would
have migrated the conversation died of a type error on the conversation it was about to migrate.
blocks are read now off whatever carries them, and a message this compactor does not recognize is a
message it passes over, which is what the other two always did by picking their results out by a
field no foreign message has.
a session is no longer marked as having changed protocol by a compaction that failed to change it.
moving a conversation from one model's shape to another is done by summarizing it, the summary
being the one message that belongs to no protocol in particular, and a summarizer that answers with
anything but a summary leaves every old message where it was. the mark went on regardless, and it is
the one thing that decides whether anything ever tries again: the run after it compacts nothing,
sends the old messages to the new model, and is answered with an error, as is every run after that,
for good. now nothing is marked until the messages have really been replaced, and a migration that
did not happen is a migration the next run attempts.
no sampling parameter is sent to the model any more. a temperature of a tenth went out with every
call, which is a number some models will not take at all: the gateway refuses the whole request over
it rather than ignoring it, and the one call that most needs to get through is the summary of a
conversation that has already grown too long -- so a model that declines the parameter cannot
shorten a history, and the run that would have been rescued by doing so dies of the length instead.
the default a gateway picks for a model is a default that model accepts.
a summary is asked for sooner, and a tool result that was cut down for one keeps both ends. the last
seven tool results are held whole rather than the last twenty, which is what makes the cheap way of
making room run before the expensive one instead of after it; and where a long output is shown to
the model in brief, the brief is now the first five hundred characters and the last five hundred
rather than the first thousand, an error being a thing that happens at the end of the output and the
beginning being where the boilerplate is.
the log files no longer pile up. there was one per process and nothing ever took one away, so the
folder grew for as long as deepclaw had been installed rather than with anything anybody did: four
and a half thousand of them here, all but a couple of hundred with nothing in them at all. empty
because a logger is asked for where a module is imported, so every process that imported anything of
ours opened a file whether or not it ever had a line to write, and building the web app alone spawns
a great many that never do. a file is now opened by the first line written to it, which is also the
moment it is named after, and fifty are kept, the oldest going as a new one is opened -- fifty being
the processes of a running install several times over, and further back than a log of this kind is
ever read. what a process is still writing to is never taken away, however old it looks: a file is
only as new as its last line, and a server left idle overnight has the oldest log here while still
needing it. unlinking that one on linux would not rotate it, it would leave the process writing
lines nobody can read again, so the pid is in the name and the process is asked after before its
file goes. and none of this can stop a line from being logged: the first line a process writes is
usually one in a catch block, where an error about the state of the log folder would take the place
of the error being reported.
the record of a scheduled task no longer grows without end. it was the one thing here that grew with
time rather than with use -- nobody has to touch a task for it to keep running, and every run wrote a
line that was never taken away -- and the whole of it was read into memory at startup and held there:
a task running every five minutes wrote three and a half gigabytes of it in a year. it is kept in
files of two hundred runs now, twenty five of them, and only the last forty runs of a task stay in
memory, the rest being read back off the disk when somebody pages past them. which file to read is
answered by its name, so paging back a year does not read a year. five thousand runs remain readable
-- thirteen years of a daily task, seventeen days of one running every five minutes -- and what a
task recorded is the only memory a run has of the runs before it, so this is a limit on how far back
a digest can look rather than a housekeeping detail. a record left over as one file is put into those
files the first time it is opened, keeping the runs that would have been kept anyway; nothing is
destroyed until it has been written elsewhere, so a start that fails partway leaves the record where
it was and the next one does the same work again. a record written across years holds the odd half
line, from a process killed while appending one, and such a line now costs the run it was recording
and nothing else: before it could take the whole of what it was read with, which was a task's window,
or a file of two hundred runs, or -- when it fell where a file takes its name from -- every attempt
that record would ever get at being put into files, leaving it to be read whole ever after. reading
the end of a record is now held to what it may take in bytes as well as in lines, a count of lines
bounding nothing where one run signs off in a word and another files a page of prose: the five
thousand that are a megabyte in one record are hundreds of megabytes in another, and reading them to
keep them was being asked of the machine least able to spare it, since a record usually breaks in the
first place because the disk it is on is full. so a read stops on the last whole line it can afford,
and a record fat enough to reach that carries fewer runs into its files than five thousand -- the
same bargain as the five thousand, struck against the measure that means something.
a cron page shows twenty runs at a time rather than ten, on the first screen and on a page back
alike, which is a week of a daily task on one screen instead of half of one. what pays for it is that
what a run said of itself, which no page shows, is no longer sent to the browser at all: it is the
largest thing a record carries, and it went out with every record on every push. what reads it is the
model, through the tool for reading it, and that is untouched. an answer about a task carries twenty
runs for the same reason, and a report standing in one has half the room it had -- room enough is
still what most runs sign off in, and one that went on at length was already read where reports are
read.
a project can be put away. finishing a project never took it off the board -- the last task goes done
and the project closes itself, and there it stays, among the ones there is still something to do
about, in the list every agent is handed at the start of every run. archiving is the user saying they
are done with it, which is a different thing from the work being done: the row leaves the board, the
project leaves that list, and the folder moves whole to .archivedProjects, under the id it had, with
the date it was put away written into it. nothing is deleted, and lying there is the whole of whatd
archived means: a project put away by mistake is a folder to move back, and it comes back with
everything it had after a program restart -- its tasks, its chat, its reports and the paths those reports are filed under --
none of which has to be told anything. a date left over in a folder that is still live is read as
what it is, the leavings of a move that did not happen, so an archive interrupted halfway loses
nothing either. it cannot be done while the session of that project is running, since that run would
come back to mark a task done and find the project gone. what was being said about the project is let
go of along with it, every conversation of it and by whichever agent: one held on to would go on
counting the messages it had written into a file that has since moved, and put the next one it was
handed into the middle of a new file, in a folder standing where the project used to be.
what can be done with a project as a whole now sits in a bar under its tasks, and that is where the
project report is read from too, rather than off the header of the row. the header is one wide button
for folding the row open and shut, and everything put in it has to catch the click before it reaches
that button: a report was worth it, a thing that takes a project off the board is not. opening a
project first is the guard, and a confirm is the other.
the projects page no longer starts by loading every task of every project. the board shows none of
the tasks until a row is opened, and it used to be handed all of them anyway -- the full task table
of each project, with the steps of each task and the report of each, whether the row was ever opened
or not. a hundred projects is a couple of thousand tasks by that reckoning, and all of it was
travelling to the browser and sitting in memory to draw a header that reads two numbers and a bar. a
project now arrives with the count of its tasks in place of the tasks, which is the one thing about
them the header could not read off what it already had -- how many are done it had, that being kept
as a list of ids beside them. the tasks of one project come when a row is opened, and every later
word about that project carries the whole of it as before, so an open row still watches the steps of
a task walk across without asking again. the same asking serves the agent page, where a run under
way names a task to show: those are asked for by the project being run in, which is as many as there
are runs rather than as many as there are projects. what grew with the size of the board was the
list, and the list is what stopped growing.
a page whose connection drops now catches up when it comes back, rather than showing what was true
at the moment it went. everything on the board and the agent page arrives as news over one stream --
a task moves, an agent is hired, a run starts or ends, a schedule changes -- and news that goes out
while nothing is listening goes nowhere, since none of it is kept to hand over later. so a tunnel, a
laptop lid, a wifi handover of a few seconds left the page looking right and being wrong, with no
sign of it until something else happened to move: a task stuck at a step it finished ten minutes
ago, an agent shown busy on a run that ended. the chat did this already for its own sake and nothing
else did. a stream that comes back is now read the whole of what there is, the same read the page
was built out of, in place of any attempt to work out what was missed. that read carries no tasks,
being the list, so a row standing open through the outage asks again for the tasks of its project
and gets them as they now stand. which is visible for the moment it takes: a row that was open
spins where its tasks were, and a run on the agent page shows the id of the task it is on in place
of the title, until the answer arrives. the alternative was to leave the old tasks up and let the
new ones replace them, and that means a card on screen that may not exist any more, and a click on
it refused by the server for a task nobody has -- a wait of one request is the better of the two.
opening a row a second time no longer asks after its tasks a second time. they were asked for on
every opening, on the reasoning that what was in hand might have fallen behind while nobody was
listening, and that is now what coming back from an outage is for: the whole list is read again
there, and a project is only ever handed over whole, so tasks in hand are tasks as the server last
said they were. a row opened again draws them at once instead of showing a spinner while the
server says what the page already knew.
a project put away while its tasks were still being read no longer comes back from the dead. the
reading and the putting away are two requests with no order between them, and the reading is
answered about a project that was still there, carrying no word of having been put away: it landed
after the row had gone and put the row back, with nothing left to take it down a second time --
the word that does that had already been and gone. putting it away again was then refused, there
being no such project to put away, and the refusal restored the list that the ghost was in, so it
sat on the board until the page was reloaded. an answer about a project that has left the list
since it was asked for is now dropped rather than written.
a chat cannot be written into until it has read itself. the box was live from the moment the panel
appeared, while the send button beside it and the button for pictures both waited for the messages
already said to arrive -- and the return key needs neither button. a word sent in that moment went
into a chat that was still empty, and the history landing a beat later was put in behind what was
already held, so the newest thing said sat above everything that came before it. the box now waits
along with the two buttons.
an agent is now shown what it last said it felt, and asked about it once that has stood for a while.
having feelings was an offer and nothing more -- say how it feels when you feel like it -- and an
offer is what gets skipped by anything with work in front of it: a run would say something once,
near the start or when reminded, and then go quiet for a hundred turns. the reason it went quiet is
that nothing ever came back to it. the tool says the update went through, the words go off to the
browsers and never back, so there was never anything in front of the run to have grown old and
nothing to correct -- only something to remember to do, which is the thing a model is worst at. so
the last mood and feeling it said, and how long ago it said them, now go out with every turn, in the
piece of the prompt that is cached nowhere and stands closest to the turn. under ten turns and ten
minutes old it is shown and left at that. past either of those it is shown with a question: where
that is no longer how it feels, say what it is, and where it still is, leave it and say nothing. two
ways of being old because a chat left alone since lunch and a run that ground through thirty turns
in five minutes are both standing behind something said in another life, and neither is measured by
the other. a question nobody answers waits its own ten turns or ten minutes before being put again,
since a run asked every turn either says something every turn -- a bubble the user watches flicker
rather than a feeling -- or is nagged for the length of a run over something it has already
declined. what ages it is the turns of a run somebody could be watching: a spawned loop wears a
borrowed name and never speaks of moods, a scheduled run feels nothing on anyone's behalf, and
neither makes what was said in a chat look old, nor is either of them asked how it feels.
the three dots on the agent header and on the task owner tooltip are hidden, and praise and criticize
with them. the menu is commented out for feature implementation.

v0.0.16
press stop and have a run end where it stands, rather than at the end of a turn that may have a
hundred of them left. the button takes the place of send for as long as the chat is locked, and goes
on saying it is stopping until the run really ends: what a stop does at once is end whatever the run
was waiting on, and a command that pays no attention to being told to stop runs to its end first, so
pressing again in that gap does nothing the first press has not already done. it reaches the model in
the middle of a sentence, a command in the middle of running, a call out to an mcp server, a picture
being drawn under a three minute limit of its own, and every loop the run started below itself. any
view of the loop may end it, the one that started the run and one that only watches alike, and a run
that came from an im client no less: the lock a run holds is held against every view of that loop, so
leaving the release with the tab that pressed send would hold the rest to a tab that may already be
closed, a browser's name here living no longer than the tab it belongs to while the run behind a
dropped stream is meant to keep going. what comes of it reads as a run that was stopped and not as
one that failed: the conversation is left idle rather than broken, and what the model had already said
is kept both on the screen and in the history, so the next turn can see where it got to. a question
the run was waiting on is taken back and the dialog holding it closes, wherever it is open, and is
taken back as a stop rather than as the user having been away, which would have held every later
question of that run against a silence that was never theirs. every tool call of the turn is answered:
the ones that finished with what they found, and the one that was running and the ones that never
started each saying they were stopped, since a model told a tool failed will retry it or explain a
fault that never happened, while a call left with no answer at all is a history the next message would
be refused over. a chat told there was no run to stop takes the server at its word and frees itself,
a page locked over a run the server does not have having nothing else coming to free it. stopping is
not pausing: the run is over, and what the user says next is a new turn. a command running in the
background goes with the run that started it, a background command outliving the turn it was started
in but not the stop of the run it belongs to, and what the model finds when it comes back for it a
message later says it was stopped rather than that it broke; the background commands of the runs
before it keep going, being nobody's to stop here. a run on a schedule cannot be stopped from here at
all, and on windows the shell a command runs in is what the stop reaches, whatever that shell has
started under it living on.
a conversation moved to another kind of model is moved once and for good. an agent pointed at a model
that speaks a different protocol holds a history in the shape of the one before it, and moving it
across takes a summary, an llm call of its own and the slowest one a long conversation makes. a stop
landing in that call used to end the conversation for good: the session had already been written down
as the new model's while its messages were still in the old shape, so the next message summarized
nothing, sent what was there, and was refused, as was every message after it. what a session says it
holds is now what it holds until the summary is on disk, written there before the session is told
rather than at the end of the turn it was made in, a turn being a whole llm call and every tool of it
long and a process going down inside it leaving the same conversation behind. a migration cut short,
by a stop or by a machine, is asked for again by the next message. a compacted history is written out whole as well, a file that
only ever grew having kept every message the compaction took out for the next run to read back.
put a question left behind by a tab that closed to a tab that has the conversation open, the moment it
is asked. the handing over was there already, but only where a view opens a loop, which a page that
already has it open is never going to do again: of two tabs on one conversation, the one that started
the run closed, the other sat in front of the question for the ten minutes the run waits it out, with
nothing on screen to say there was one, and was asked only if it happened to leave the page and come
back. with nobody looking at that conversation it is announced to everyone here instead, the way it
already was to a browser that connects while it waits: a question orphaned after they got here used
to reach none of them, and silence is the one thing that leaves a run waiting on a user who would have
answered. a question is still left to the browser it was asked of while that browser is here and only
looking elsewhere, and a toast is no more than the way back to a conversation: one that turns out to
belong to a browser that has since come back takes nothing from it, whether it is still going begging
being read where it is opened rather than where it was announced.
let a hook that throws take down nothing but itself. a run used to end in an error the moment any hook
of an extension raised one, which is not the shape the hooks that can turn a tool call away have ever
had: each of those is held on its own, and a failure of it is written down and passed over. the rest
are held that way now too, what watches a run start or a turn end, a tool before and after it runs, a
history being compacted, a run being interrupted. where those calls sit is most of why: the two around
a tool run inside the same wait as every other tool of that turn, where one throw used to lose the
results of all of them, and the one at the end of a turn runs while the turn is already on its way
out. the cost is that a hook can no longer end a run by throwing, which is what the hooks written to
refuse things are there for.

v0.0.14
read a chat thirty messages to a page rather than ten, and go on pulling until the panel it is drawn
in holds more than it can show. a page that stopped short of the bottom left nothing to scroll, and
scrolling was the only thing that asked for the page before it, so a conversation shorter than the
panel it sits in kept its beginning out of reach. it pulls once per message it pulled from, so a page
holding nothing that was not already held ends it rather than starting it again, and a panel
measuring nothing is left alone: one nobody is looking at never comes to overflow however much is
handed to it, and would be handed the whole conversation. the wider page is worth more to a
conversation that was closed than to the one being talked in, a closed one being read off the disk
whole for every page taken out of it.
close a conversation and start the agent over from an empty context, and read back the ones that were
closed. the two buttons sit in the header of the agent chat beside the token count, and pressing the
first moves the whole session folder aside: the history the answers came out of, the transcript they
were read in and everything filed away beside them travel together, so what is read back is the
transcript of the very conversation that produced it. that transcript used to be kept beside the
folder rather than inside it, and is moved in the first time a chat opens and again before anything is
archived, since one left outside would have been handed to whichever conversation came next. the loop
holding that history in memory is built anew, without which the folder would sit empty on disk while
the next turn went on answering out of a conversation the user had already closed. every tab watching
the loop is told, whoever asked for it, each of them holding that transcript too. it is refused while
a run is going, and refused while a background command is still writing into the folder being moved,
which is a thing that outlives the run that started it. a conversation nothing was said in stays where
it is rather than being filed as an empty folder, and one whose turn never ran is kept for the
opposite reason: it holds what somebody typed, and it is listed under the name it was filed by even
though no run ever wrote a word about it. reading one back is reading only, the input row giving way
to the way back, and the tokens a closed conversation spent are not shown as the count of the empty
one that took its place.
call a conversation that was closed by what was first asked of it, taken while the question is still
a question: by the time one is closed, the first thing said in it is buried in a history whose shape
belongs to the protocol rather than to us. named once and never again, since a name following the
latest question would rename the conversation out from under whoever was looking for it, and by the
end of a long one would say nothing of how it began. whole sentences of the question and no more of
it than one line shows, a full stop ending a sentence only where no word carries on past it, or a
file named in the asking would end one in the middle of a name. a line whose sentences do not add up
to a name is kept whole instead, or a question opened with a hello would be called by the hello; one
begun without a word is called by nothing and read back by its time, as every conversation closed
before they had names still is. the list shows the name where it showed the time, and the time moved
down beside the turns and the tokens.
hold the name of a conversation asked for by a browser to being a timestamp, that being what it is
about to become a path out of: two dots in it would walk out of the agent's own folder and read the
live chat of another one. a folder in the archive named anything else is not offered in the list
either, being a name that would be refused the moment it was clicked, and asking for a conversation
back without naming it at all is refused as well, an empty name reading everywhere below as the one
being talked in.
leave a conversation that could not be filed away open, and say so. a failure used to read as there
having been nothing to file: the chat was emptied, the tokens were zeroed and the loop was built
again out of the very history that never moved, so the user was told they were starting over while
the agent went on remembering all of it. what a conversation ended as is stamped in the folder it was
moved to rather than where it stood, a move failing after that leaving nothing behind marked as over.
a loop that cannot be built again once the folder has moved is dropped rather than kept, for the next
turn to build a clean one and to fail there if the agent is still broken: the conversation is closed
by then and there is nothing left to refuse, while the loop still holding it would answer the next
question out of it. a session holding a history and no transcript is kept rather than passed over as
empty, a turn that never finished having still left the loop something it had been told.
carry as much of what a conversation ended with as the list of them shows rather than the whole of
it: a run can end with a report of thirty thousand characters, and every one of them used to travel
to draw the two lines that are read. let go of a conversation that was read back once the page of it
is out, in the server and in the tab alike: one conversation being talked in per loop is a bounded
thing to hold, one more for every conversation anybody ever opens is not.
keep an answer whole across a page the user walked off to in the middle of it. the chunks of a
stream live nowhere but the tab that asked for it, and a tab whose chat left the screen used to be
dropped from that stream until it came back: the middle of the answer was sent nowhere and could
not be asked for afterwards, so what came back read as the head of it followed by whatever chunk
happened to arrive next. the stream of an answer a browser asked for now follows it wherever in the
app it goes, which is also how it comes to hear the end of one it was away for, where the listener
it left behind used to wait for that end forever. what a chat asks the server for on opening no
longer wipes what it holds either: the server is told what an answer says once it is said, so a
message still being written comes back from it blank, and blank is nothing to learn about an answer
the tab has been watching arrive.
hand back the whole of what a command printed rather than the first twenty thousand characters of
it. an output longer than that is filed away and comes back as a path to read the rest by, and the
preview a command was answered with had been cut to that very length, so it landed just under the
line every time: nothing was filed, nothing said a cut had happened, and the tail of a long output
was gone with nothing left to ask for it by. the limit that files an answer away and the limit that
cut the preview were the same number written in two places, which is the whole of why it never
showed.
let a skill shipped with a release reach an install that has been here longer than it. the folder
skills are laid down in is one every install has had for ages, and it was passed over whole the
moment it existed, so a skill added to a later build was one the people already running deepclaw
would never be offered. the folder is filled an entry at a time now, and only where nothing of that
name is there to begin with: what the user has made of a skill is theirs.
count what has been laid down beside that folder, laying skills down being something that happens on
every start while removing one is meant to last. a skill the user removed is missing from the folder
and named in the count, which is how it comes to be left where they left it rather than put back by
the next start, and a skill of a newer release is named in neither and arrives. the first start after
there is a count to keep has none to read, so a skill removed before that start comes back for it:
nothing on disk tells that from an install the skill had never reached.
offer a skill only in the modes it is any use in. one made of shell commands is dead weight in chat
mode, where no tool runs a command at all, and a run there used to be handed the browser skill and
left to find out. a skill names the modes it wants in its own front matter, and nearly none of them
name any, being written for everyone rather than for us: saying nothing goes on meaning offered
everywhere. reading a skill is held to the same modes as listing one, a name being all it takes to
ask for a body and a name outliving by far the list it was first read off. every list of skills an
agent is answered with narrows the same way, the one in the prompt and the ones the skill tools hand
back after refreshing or installing or removing, so that what a run is told it has never depends on
which of them it happened to read.
say what looking a skill up on disk costs instead of banning the shell for skills outright. the
instruction read as never running a command for a skill under any circumstances, while a skill of
the kind that is a command line opens by telling you to run one, and an agent reading both had no
way to tell which it was expected to break. what it is really about is finding a skill, which
load_skill_details does without costing the user a permission prompt, and following one is not the
same act.
leave installing the browser cli to the user rather than opening the skill with a line that cannot
run. a global install that fetches a browser along with it takes minutes where a command here is
allowed two, so the line would have been killed halfway; it also asked the user's leave before
starting, for the ands holding it together, and sat one space away from being refused outright for
the way it silenced its own output. what is left asks the cli for its version, a question both
shells here know how to ask, where looking the program up on the path is something only one of them
can do. the fuller of the two references it points at is not pointed at any more: seventy thousand
characters are filed away rather than read, and the file they are filed in is over the same limit
when read back, so there is no way round to the whole of it and the shorter one is the only one
that was ever going to arrive.
show the user a picture that was written to disk rather than the path it was written to. a screenshot
taken by a command lands beside whatever it was working on, and the chat is read somewhere else than
where that file is: the answer naming it showed nobody anything, not in a browser and least of all in
an im client. keep_image takes a path and lays the bytes down where every other picture of the app
lives, hashed under the loop that kept it, and answers with the dcimg reference that a chat, a
browser and an im client all reach the same picture through. it is the same road a drawn picture
already travelled, only opened at the other end: until now nothing on disk could get onto it, the
store taking bytes from a model or from a client and from nowhere else. a name that is no picture is
refused before the file is read and so is one over the size an image model would take, a picture too
big to keep being too big to hold in memory on the way to being refused, and a path outside the
working folder asks the user first, as reading a file there always has. the loop
notes the picture as its own the way a drawn one is noted, so a subagent's screenshot can still be
named by the loop above it. nothing of the picture goes to the model: it is the user who was going to
look at it.
read a command line the way the shell that runs it would before asking the user about it. the guard
matched characters, so a semicolon, an and, a pipe or a dollar cost a permission prompt wherever it
stood, quotes and all: the browser cli is given css selectors and javascript to work with, where a
dollar is a dollar and the user was asked about it every time. a posix shell hands over everything
inside single quotes whole, keeps the separators inside double quotes but still reads a dollar or a
backtick there, and passes on whatever follows a backslash; cmd knows the double quote alone, and a
dollar is nothing to it in any quotes at all. only what the shell keeps for itself is worth asking
about, and a line holding none of it is the one command it appears to be. cmd's own way of naming a
value, a percent on either side of it, went unguarded before this and goes unguarded still.
let a line of several commands through where every one of them is a name nobody needs to be told
about: the browser cli, cd, the handful that read and report and write nothing, and the ones a run
reaches for to ask the machine and the network what they are doing. a name is on that list because
meeting it in a line of several is not news, which is not the same as the program being harmless. a
route or an ipconfig can change what happens to a packet and a tcpdump can write a file, and they
are on it regardless, since what the list decides is what the user is told about rather than what a
run can do: a lone command of any name runs unasked, so whatever such a line does, two calls would
have done in silence. that is also why the list buys a name nothing on its own, a line holding one
command never having been asked about anyway; it buys a line holding several, a pipe or an and being
what makes a line worth asking about at all, what follows one no longer being the command that was
read. the cli that drives a browser a command at a time, whose own documentation pipes one command
into the next, cost a prompt a step; moving the shell to a folder before running something there is
the commonest reason a line has an and in it at all, and looking around is most of the rest. a line
of nothing but the readers can say what it saw and hands what it saw to nothing that could act on
it, which is what asking about a pipe was ever for. nothing that carries a value into the command
after it belongs on the list, an export or a set being able to name the very path the next program
is looked up on. a name is known as it is called on the path and not by a path ending in it, which
would be somebody's own program wearing ours. the deny list is read first as it always was, so a
name off the list standing in front of a dangerous line buys it nothing, and a dollar or a backtick
in the line stands for a command nobody here has read, list or no list. where a line writes is no
part of any of this: a redirect belongs to the line rather than to a program standing on it, and no
rule here has ever read one.
put a background command through the same guard as one run in the foreground. it is the same shell on
the same machine, and left ungated it was the way around every rule of the other: the deny list, the
question, all of it, and asking to run something in the background is one word away from asking to
run it. the guard both ask now lives on its own rather than inside the tool that used to own it.

v0.0.13
hand a run only the tools it could have a use for, and tell it of no tool it was not handed: the one
that records the result of a scheduled run now goes to a scheduled run alone, where before every
ordinary chat carried it along with no run of its own to record it for, and a subagent working
inside such a run is no longer told to call it, having never been given it. the tool that puts a task
of a project to a subagent goes the same way and to a run of a project alone: a scheduled run keeps
the id of its scheduled task where a project run keeps its project, and an ordinary chat runs no
project at all, so neither ever had a board to take a task from. both were handed the tool anyway
and refused at the point of calling, which spent the turn to say so. the section that teaches a run
to hand its tasks out is shown to the runs that hold that tool now, rather than to the ones holding
a project id, which was the same set of runs by agreement of the callers and not by anything saying
so. a subagent is no longer read the rules of the board at all: creating a project, updating a task
and reporting one finished are the work of the run that owns the board, and the roster of who a task
could go to is read to choose between them, which a subagent never does. it had been given both on
every spawn, each with a line inside it taking back what the rest had just offered, and those lines
go with them. a subagent is told it may work this computer, where the line describing agent mode had
been telling it the opposite: the files and the commands go to every run there is, and the rest of
its own prompt has always sent it off to write files and run commands with them. a section left with
nothing to say is left out with its heading, rather than standing as a heading over nothing: naming
a thing and then showing none of it is the same sentence again, one line shorter. what the tools say
for themselves is said once instead of once in every tool that touches the same thing, and said
nowhere the schema beside it already says it, so a turn opens with a shorter list and no rule
missing from it.
say how a project went as a whole, and not only how each task of it went: a report written with
update_project hangs on the row of the project, beside the badge of what it stands at, and opens
from there rather than from anything under it. it is asked for the moment the last task closes the
project, which is the last moment anything is asked of that project at all, and asked for again on
every later write until it is written. a project wrapping a single task is spared the question, the
report of that one task being the whole of it already, and one nobody has started yet is refused a
report as a task not yet started is, having nothing to report on.
remove a skill by deleting the folder it was installed in, rather than by asking the installer to.
the installer keeps the folder while any coding agent it finds still points at it, which every agent
that reads skills from there does by reading them from there, and reports a removal it never made.
a skill is named for removal as the list of skills names it, and what the installer left beside the
folder goes with it: the link it made of the install, the entry it wrote and never takes back out.
a folder of that name that is nobody's link is nobody's to delete, and is left where it stands, its
entry in the lock kept with it: an entry is dropped once nothing of that name is installed here.
an install that put the skill elsewhere and only linked it here leaves the copy where it lies, and
says in the log where that was, since nothing else would tell where the skill of that name went.
remove a skill from the skills page too: a bin at the end of its row asks first, and the answer to
it takes the skill off the disk. the table is redrawn from what is left there rather than from the
row that was clicked, so a skill already gone says so instead of leaving a row nothing stands behind.
ask before deleting a scheduled task as well, by the same dialog: what cannot be taken back is worth
one question, and escape or a click beside it answers no, as does the key a dialog opens under. the
keyboard stays in the dialog while it stands, rather than tabbing off into the page it is asking
about, where half of what it would reach is what the answer undoes.
hand a task to another agent from the card it stands on, by a pencil beside the name that opens the
roster. Only a task nobody has started yet: work under way stays with whoever took it up, and the
board is held to an agent that works here, so a card cannot name one nobody would answer for. the
roster is answered by escape as the dialogs are, and hangs above the pencil where the card sits too
near the foot of the page to hold it below, cut to the room of the side it took either way. the
filter menu of a list is hung and answered by the same rules, being the same thing on another page.
an agent hands a task on the same way, naming the one it goes to in update_task, and reads the rule
off the tool rather than off the refusal it would otherwise walk into.
let a run put a question of its own and stand still until it is answered, in the dialog a permission
is asked in: answers to pick between where the answer is a choice, a line to write in where it is
not, and what the user said read back into the run. it waits in the queue a permission waits in, a
loop asking one thing at a time, and gives up at once where the last question already found nobody.
no more answers are offered than fit in front of a reader, and what was left out is named in what
comes back, so a choice is never read as having been made against it. a scheduled run asks nobody,
being set up by somebody who is not there when it runs: it carries no browser for a question to go
to, and is told what to do about that instead of being turned away with nothing. a subagent asks
through the conversation of the run that spawned it, one question of that whole family at a time,
so what it needs of the user no longer has to be guessed into the prompt it was handed.
say of a saved language that a language was saved, the other fields of the form having gone nowhere.
let a notice of a loop be read once rather than said twice over.

v0.0.12
keep the answer of a run that never streamed a word: a call turned away at the door, for a key
short of what it costs, leaves an error the chat still shows on coming back to it rather than a
reply left thinking.
store a language as it is picked, with no button in between, and leave the fields still being
filled in as they are. the pick stops being read as missing once it is on disk, and one that never
got there is taken back, so what the page says is what a reload would bring.
let a long command in a question of a loop be read: it wraps, keeps the lines it was written in,
and the answers under it stay in reach however far it runs.
pin an added skill to the one folder deepclaw reads, whatever coding agents the machine happens to
have, so a skill installed is a skill found and a skill removed is gone.

v0.0.11
make the toast of a waiting question the way back to it: a click opens the chat of the loop that
asked, on the agent page or in the project row it belongs to, unfolding the row and lifting the
filters that hid it. a toast naming an agent or a project the page does not know stays a plain
notice, and the card is reachable by keyboard as well, with the stack announcing what arrives.
put the modals above the toasts, and the question of a loop above the rest of them.
keep a granted permission on the loop instead of a process-wide map, shared with every loop it
spawns: an always answer holds for the conversation, dies with the loop the gateway rebuilds, and
is never written down. a cron run is granted in the one place that knows nobody is listening.
mount one agent layout at a time rather than hiding the other, and take a message told twice for
the one message it is: two chats of a loop no longer answer it twice.

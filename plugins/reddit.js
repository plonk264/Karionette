// Subreddit announcer
"use strict";
const [DB, lib, web, logins, ial, ticker] = plugin.importMany("DB", "lib", "web", "logins", "ial", "ticker"),
	subDB = new DB.Json({filename: "reddit/subreddits"});

function r(sub) {
	return "https://www.reddit.com/r/"+sub+"/new/.json?limit=10";
}

function shortenRedditLink(link, sub, id) {
	if (link.indexOf("reddituploads.com") > -1)
		return "https://redd.it/"+id;
	if (link.indexOf("www.reddit.com/r/") === -1)
		return link;
	let reg = /https\:\/\/www\.reddit\.com\/r\/([^\/]+)\/comments\/([^\/]+)\//.exec(link);
	if (reg && reg[2]) {
		if (reg[1].toLowerCase() !== sub)
			return "https://redd.it/"+reg[2]+" (r/"+reg[1]+")";
		return "https://redd.it/"+reg[2];
	}
	return link;
}

function getDeliveryMethod(nick) { // this ugliness brought to you by the letter R[anma].
	const method = new DB.List({filename: "reddit/methods"}).search(nick+": ", true);
	if (method && method.length)
		return method[0].split(": ")[1];
	return "notice";
}

function findNewPosts(subreddit) {
	if (!subreddit)
		return; // probably failed JSON.parse
	const methods = {}, isOnline = {}, sub = subreddit.sub.toLowerCase(), entry = subDB.getOne(sub);
	let changed = false;
	entry.seen = entry.seen || [];
	for (let k = 0; k < subreddit.posts.length; k++) {
		if (entry.seen.indexOf(subreddit.posts[k].id) > -1) // seen it
			continue;
		const post = subreddit.posts[k],
			postMessage = lib.decode(`r/${sub} - ${post.title} ~ ${shortenRedditLink(post.link, entry.subreddit, post.id)}`);
		changed = true;
		entry.seen.push(post.id);
		for (let n = 0; n < entry.announce.length; n++) {
			const nick = entry.announce[n];
			isOnline[nick] = isOnline[nick] || (ial.User(nick) ? "online" : "offline");
			if (isOnline[nick] === "offline")
				continue;
			methods[nick] = methods[nick] || getDeliveryMethod(nick);
			irc[methods[nick]](nick, postMessage, true);
		}
	}
	if (changed) {
		if (entry.seen.length > 20)
			entry.seen = entry.seen.slice(-20);
		subDB.saveOne(sub, entry);
	}
}

function trimJson(source) {
	let res;
	try {
		res = JSON.parse(source);
	} catch (err) {
		// die quietly. sometimes reddit returns non-JSON when overloaded.
		return;
	}
	const ret = [], hits = res.data.children;
	for (let i = 0; i < hits.length; i++) {
		ret.push({
			id: hits[i].data.id,
			title: hits[i].data.title,
			link: hits[i].data.url
		});
	}
	res = null;
	return { sub: hits[0].data.subreddit, posts: ret };
}

function checkSubs() {
	if (!subDB.size())
		return;
	lib.runCallback(function *(cb) { try {
		for (let i = 0; i < subDB.data.keys.length; i++) {
			const sub = subDB.data.obj[subDB.data.keys[i]];
			if (!sub.announce || !sub.announce.length)
				continue;
			findNewPosts(trimJson(yield web.fetchAsync(r(sub.subreddit), null, cb), sub.subreddit));
		}
	} catch (err) {
		logger.error("checkSubs - "+err.message, err.stack);
	}});
}

function subscribe(nick, sub) {
	const entry = subDB.getOne(sub);
	if (!entry)
		return "I'm not watching r/"+sub;
	const lnick = nick.toLowerCase();
	if (entry.announce.indexOf(lnick) > -1)
		return "You're already on the announce list for r/"+sub;
	entry.announce.push(lnick);
	if (entry.announce.length === 1) // first entry!
		checkSubs();
	subDB.saveOne(sub, entry);
	return "Added! o7";
}

function unsubscribe(nick, sub) {
	const entry = subDB.getOne(sub);
	if (!entry)
		return "I'm not watching r/"+sub;
	const lnick = nick.toLowerCase(),
		index = entry.announce.indexOf(lnick);
	if (index === -1)
		return "You're not on the announce list for r/"+sub;
	entry.announce.splice(index, 1);
	subDB.saveOne(sub, entry);
	return "Removed. o7";
}

function addSubreddit(sub, user) {
	if (sub === "all")
		return "r/all produces too much traffic for this kind of thing.";
	subDB.saveOne(sub, {
		subreddit: sub,
		addedBy: user,
		announce: [],
		seen: []
	});
	return "Added! To get announcements from r/"+sub+", users need to "+config.command_prefix+"subreddit subscribe "+sub;
}

function removeSubreddit(sub) {
	if (subDB.hasOne(sub)) {
		subDB.removeOne(sub);
		return "Removed. o7";
	}
	return "I'm not watching r/"+sub;
}

function reddits(subs) {
	return lib.commaList(subs.map(sub => "r/"+sub));
}

function listSubreddits(target) {
	if (!subDB.size())
		return "I'm not announcing updates to any subreddits.";
	if (target) { // go through the entries and list them if they're announced to target
		const ret = [], ltarget = target.toLowerCase();
		for (let i = 0; i < subDB.data.keys.length; i++) {
			const sub = subDB.data.keys[i];
			if (subDB.data.obj[sub].announce.includes(ltarget))
				ret.push(subDB.data.obj[sub].subreddit);
		}
		if (!ret.length)
			return "I'm not announcing any subreddit updates to "+target+".";
		return reddits(ret)+" updates are being sent to "+target+".";
	}
	return "I'm announcing updates to "+reddits(subDB.getKeys())+".";
}

ticker.start(300); // 5 minute ticker

bot.event({
	handle: "subredditCheck",
	event: "Ticker: 300s tick",
	callback: checkSubs
});

bot.event({
	handle: "subredditCheckOnStart",
	event: "autojoinFinished",
	callback: checkSubs
});

bot.command({
	command: "subreddit",
	help: "Subreddit announcer.",
	syntax: `${config.command_prefix}subreddit <add/remove/subscribe/unsubscribe/list/method> [subreddit] [target] - Example: ${config.command_prefix}subreddit add aww - add and remove are admin only.`,
	arglen: 1,
	callback: function subreddit(input) {
		switch (input.args[0].toLowerCase()) {
		case "list":
			if (input.args[1] !== undefined)
				irc.say(input.context, listSubreddits(input.args[1]));
			else
				irc.say(input.context, listSubreddits());
			break;
		case "add": {
			if (!logins.isAdmin(input.nick)) {
				irc.say(input.context, "You need to be an admin to add or remove subreddits I track. See subscribe if you want announcements from a tracked subreddit.");
				return;
			}
			if (input.args[1] === undefined) {
				irc.say(input.context, bot.cmdHelp("subreddit", "syntax"));
				return;
			}
			let lsub = input.args[1].toLowerCase();
			if (subDB.hasOne(lsub)) {
				irc.say(input.context, "I'm already watching for updates to r/"+lsub);
				return;
			} // need to check if the sub exists
			web.fetch(r(lsub)).then(function (body) {
				if (body.indexOf("https://www.reddit.com/subreddits/search?q=") > -1) {
					irc.say(input.context, "r/"+input.args[1]+" doesn't seem to be a thing.");
					return;
				}
				if (body.indexOf(": banned</title>") > -1) {
					irc.say(input.context, "r/"+input.args[1]+" is a banned subreddit.");
					return;
				}
				irc.say(input.context, addSubreddit(lsub, input.user, input.context));
			}).catch(function (error) {
				logger.error(error, error);
				irc.say(input.context, "Something has gone awry.");
			});
			break;
		}
		case "remove":
			if (!logins.isAdmin(input.nick)) {
				irc.say(input.context, "You need to be an admin to add or remove subreddits I track. See subscribe if you want announcements from a tracked subreddit.");
				return;
			}
			if (input.args[1] === undefined) {
				irc.say(input.context, bot.cmdHelp("subreddit", "syntax"));
				return;
			}
			irc.say(input.context, removeSubreddit(input.args[1].toLowerCase()));
			break;
		case "subscribe":
			if (input.args[1] === undefined) {
				irc.say(input.context, bot.cmdHelp("subreddit", "syntax"));
				return;
			}
			irc.say(input.context, subscribe(input.nick, input.args[1].toLowerCase()));
			break;
		case "unsubscribe":
			if (input.args[1] === undefined) {
				irc.say(input.context, bot.cmdHelp("subreddit", "syntax"));
				return;
			}
			irc.say(input.context, unsubscribe(input.nick, input.args[1].toLowerCase()));
			break;
		case "method": {
			const arg = input.args[1] ? input.args[1] : false;
			if (!arg || (arg !== "msg" && arg !== "notice")) {
				irc.say(input.context, `[Help] Syntax: ${config.command_prefix}subreddit method <msg/notice>`);
				return;
			}
			const methodDB = new DB.List({filename: "reddit/methods"});
			methodDB.removeMatching(`${input.nick}: `, true);
			methodDB.saveOne(input.nick+": "+(arg === "msg" ? "say" : arg));
			irc.say(input.context, "I'll deliver your subreddit updates via "+(arg === "msg" ? "/msg" : "/notice")+" from now on.");
			break;
		}
		case "check":
			checkSubs();
			break;
		default:
			irc.say(input.context, bot.cmdHelp("subreddit", "syntax"));
			break;
		}
	}
});

// ;nocontext - pulls a random nocontext
bot.command({
	command: "nocontext",
	help: "Pulls a random r/nocontext title.",
	syntax: `${config.command_prefix}nocontext`,
	callback: function nocontext(input) {
		web.json("https://www.reddit.com/r/nocontext/random/.json").then(function (result) {
			irc.say(input.context, result[0].data.children[0].data.title);
		}).catch(function (error) {
			logger.error(";nocontext: "+error, error);
		});
	}
});

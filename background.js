// Only load for bing.com domain
chrome.webNavigation.onCompleted.addListener(function(details) {
	chrome.pageAction.show(details.tabId);
}, {url: [{hostSuffix: "bing.com"}]});

chrome.pageAction.onClicked.addListener(function(tab) {
	perform(tab.id, tab.url);
	var fireEvery = 180; // minutes
	localStorage["bing_reward_tab_id"] = tab.id
	localStorage["bing_reward_tab_url"] = tab.url
	chrome.alarms.create({delayInMinutes: fireEvery, periodInMinutes: fireEvery});
	console.log("Scheduled next run");
});

chrome.alarms.onAlarm.addListener(function() {
	console.log("Alarm: " + Date());
	perform(parseInt(localStorage["bing_reward_tab_id"]), localStorage["bing_reward_tab_url"]);
});


var terms = [];
function getTerms() {
	if (terms.length == 0) {
		console.log("Getting terms");
		// Get a list of search terms
		var xhr = new XMLHttpRequest();
		xhr.open("GET", "https://en.wikipedia.org/w/api.php?format=json&action=query&list=random&rnlimit=10&rnnamespace=0", false);
		xhr.onload = function() {
			var queries = JSON.parse(xhr.responseText).query.random;
			for (var k in queries)
				terms.push(queries[k].title);
		}
		xhr.send();
	}
	term = terms.pop();
	if (!term) {
		throw "Need better terms"
	}

	return term;
}

function ticketRemaining(comm) {
	return comm.TicketCap - comm.TicketProgress
}

function urlrewards(comm) {
	console.log("Running urlrewards");
	// Active the other offer links
	var xhr = new XMLHttpRequest();
	xhr.open("HEAD", "http://www.bing.com" + comm.Message.destinationurl, false);
	try {
		xhr.send(null);
	} catch(e) {
		console.log("Error running urlrewards");
	}
}

function search(comm) {
	var searchParams = comm.Message.description.match(/\d+/g);
	var totalSearches = searchParams[1] * ticketRemaining(comm);

	for (i = 0; i < totalSearches; i++) {
		// Search away
		var url = "http://www.bing.com/search?q=" + getTerms();
		var xhr = new XMLHttpRequest();
		xhr.open("GET", url, false);
		try {
			xhr.send(null);
		} catch(e) {
			console.log("Error running search");
		}
	}
}

function searchWithTabs(tab_id, func_done) {
	var url = "http://www.bing.com/search?q=" + getTerms();
	chrome.tabs.update(tab_id, {"url": url}, function(tab) {
		var loadNext = function(tab_id, changedProps) {
			if (changedProps.status != "complete")
				return;

			if (decrementTotal() >= 0) {
				// Load the next one
				searchWithTabs(tab_id, func_done);
			}
			else {
				func_done();
			}
			chrome.tabs.onUpdated.removeListener(loadNext);

		}
		chrome.tabs.onUpdated.addListener(loadNext);
	});
}

function setMobileEnv() {
	console.log("Setting mobile");
	// Set mobile User-Agent
	if (typeof chrome.declarativeWebRequest != 'undefined') {
		chrome.declarativeWebRequest.onRequest.addRules([{
			conditions: [
				new chrome.declarativeWebRequest.RequestMatcher({
					url: {hostSuffix: "bing.com"}
				})
			],
			actions: [
				new chrome.declarativeWebRequest.SetRequestHeader({
					name: "User-Agent",
					value: "Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4"
				})
			]
		}]);
	}
	else {
		var listener;
		chrome.webRequest.onBeforeSendHeaders.addListener(
			listener = function (details) {
			for (var i = 0; i < details.requestHeaders.length; ++i) {
				if (details.requestHeaders[i].name === 'User-Agent') {
					details.requestHeaders[i].value = "Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4"
				}
			}
			return {requestHeaders: details.requestHeaders};
			},
			{urls: ["*://*.bing.com/*"]},
			["blocking", "requestHeaders"]
		);
		return listener
	}
}

function unsetMobileEnv(listener) {
	console.log("Unsetting mobile");
	// Remove mobile User-Agent
	if (typeof chrome.declarativeWebRequest != 'undefined') {
		chrome.declarativeWebRequest.onRequest.removeRules();
	}
	else {
		chrome.webRequest.onBeforeSendHeaders.removeListener(listener);
	}
}

function setTotal(comm) {
	var searchParams = comm.Message.description.match(/\d+/g);
	var totalSearches = searchParams[1] * ticketRemaining(comm);
	localStorage["bing_reward_mobile_total"] = totalSearches;
}

function decrementTotal() {
	var current = parseInt(localStorage["bing_reward_mobile_total"]);
	localStorage["bing_reward_mobile_total"] = current - 1;
	return current
}

function perform(tab_id, tab_url) {
	// Get current reward offers
	var offersXHR = new XMLHttpRequest();
	offersXHR.open("GET", "http://www.bing.com/rewardsapp/getoffers", false);
	offersXHR.onload = function() {
		var json = JSON.parse(offersXHR.responseText);
		if (json.ErrorDetail.ErrorCode == 0) {
			for (var i in json.Communications) {
				var comm = json.Communications[i];
				if (comm.State == "Active") {
					switch (comm.ActivityType) {
						case "search":
							// Check if is a mobile search
							if (comm.CommunicationId == "mobsrch01") {
								console.log("Running mobile search");
								setTotal(comm);
								var listener = setMobileEnv();
								var done = function() {
									unsetMobileEnv(listener);
									chrome.tabs.update(tab_id, {"url": tab_url});
								}
								searchWithTabs(tab_id, done);
							}
							else {
								console.log("Running search");
								search(comm, tab_id);
							}
							break;
						case "urlreward":
							urlrewards(comm);
							break;
						default:
							break;
					}
				}
			}
		}
	}
	try{offersXHR.send(null);} catch(e){}

	// Refresh the page to see the new status
	chrome.tabs.update(tab_id, {"url": tab_url});
}
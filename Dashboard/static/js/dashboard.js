(function () {
	function getInitialPage() {
		var page = $('body').attr('data-active-page');
		if (page === 'monitor' || page === 'settings') {
			return page;
		}
		return window.location.pathname.indexOf('/monitor') !== -1 ? 'monitor' : 'settings';
	}

	function startMonitor() {
		if (window.startTaskMonitor) {
			window.startTaskMonitor();
		}
	}

	function showPage(page) {
		var isMonitor = page === 'monitor';
		if (isMonitor) {
			$('#page-settings').hide();
			$('#page-monitor').show();
		} else {
			$('#page-monitor').hide();
			$('#page-settings').show();
		}
		$('.dashboard-nav-link').removeClass('active');
		$('.dashboard-nav-link[data-page="' + page + '"]').addClass('active');
		document.title = isMonitor ? '任務監控中心 - aniGamerPlus控制臺' : 'aniGamerPlus控制臺';
		if (isMonitor) {
			startMonitor();
		}
		if (history.replaceState) {
			history.replaceState(null, '', isMonitor ? './monitor' : './');
		}
	}

	window.showDashboardPage = showPage;

	var lastLoginBadgeKey = '';

	function applyLoginStatusBadge(data) {
		var $badge = $('#login-status-badge');
		if (!$badge.length || !data || !data.state) {
			return;
		}
		var key = data.state + '|' + (data.detail || '');
		if (key === lastLoginBadgeKey) {
			return;
		}
		lastLoginBadgeKey = key;
		var cls = 'badge-secondary';
		if (data.state === 'vip') {
			cls = 'badge-success';
		} else if (data.state === 'error') {
			cls = 'badge-danger';
		} else if (data.state === 'guest') {
			cls = 'badge-warning';
		} else if (data.state === 'login') {
			cls = 'badge-info';
		}
		var text = data.label || data.state;
		var title = data.detail || '';
		if (data.label && data.detail) {
			title = data.label + '，' + data.detail;
		}
		$badge.attr('title', title).html(
			'<span class="badge ' + cls + '">' + text + '</span>'
		);
	}

	window.applyLoginStatusBadge = applyLoginStatusBadge;

	function refreshLoginStatus() {
		$.getJSON('/data/login_status').done(applyLoginStatusBadge);
	}

	window.refreshLoginStatus = refreshLoginStatus;

	$(function () {
		$('.dashboard-nav-link').on('click', function (e) {
			e.preventDefault();
			showPage($(this).data('page'));
		});
		showPage(getInitialPage());
		refreshLoginStatus();
		if (window.ensureTaskProgressSocket) {
			window.ensureTaskProgressSocket();
		}
	});
})();

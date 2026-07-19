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
		$('#page-settings').toggle(!isMonitor);
		$('#page-monitor').toggle(isMonitor);
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

	$(function () {
		$('.dashboard-nav-link').on('click', function (e) {
			e.preventDefault();
			showPage($(this).data('page'));
		});
		showPage(getInitialPage());
	});
})();

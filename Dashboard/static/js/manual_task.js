var manualTaskInited = false;

function initManualTaskModal() {
	if (!manualTaskInited) {
		$('#manual_classify, #manual_danmu').bootstrapSwitch();
		$('#manual_mode, #manual_resolution').selectpicker();
		manualTaskInited = true;
	}

	if (window.syncSettingControlWidths) {
		window.syncSettingControlWidths();
		setTimeout(function() {
			window.syncSettingControlWidths();
		}, 0);
	}

	$.getJSON('data/config.json', function(data) {
		$('#manual_thread_limit').val(data['multi-thread']);
	});
}

function resetManualSubmitBtn() {
	var $btn = $('#manual_submit_btn');
	if (!$btn.length) {
		return;
	}
	$btn.prop('disabled', false)
		.removeClass('btn-danger btn-secondary')
		.addClass('btn-success')
		.text('提交');
}

function flashManualSubmitOk() {
	var $btn = $('#manual_submit_btn');
	if (!$btn.length) {
		return;
	}
	$btn.prop('disabled', false)
		.removeClass('btn-danger btn-secondary')
		.addClass('btn-success')
		.text('已提交');
	setTimeout(function() {
		if ($('#manualTasks').hasClass('show')) {
			$btn.text('提交');
		}
	}, 3000);
}

function markManualSubmitFailed() {
	var $btn = $('#manual_submit_btn');
	if (!$btn.length) {
		return;
	}
	// 請求失敗時保留網址並允許重試
	$btn.prop('disabled', false)
		.removeClass('btn-success btn-secondary')
		.addClass('btn-danger')
		.text('未提交，點擊重試');
}

function readManualConfig() {
	var $btn = $('#manual_submit_btn');
	if ($btn.prop('disabled')) {
		return;
	}

	var manualData = {};
	var link = $('#manual_link').val();
	if (link.length == 0) {
		alert('請輸入影片連結！');
		return;
	}

	// 允許貼完整網址或只填 sn，網址後綴的其他參數一併去掉
	var snMatch = /(?:[?&]sn=)?(\d+)\s*(?:&|$)/.exec(link.trim());
	if (!snMatch) {
		alert('無法從連結取得 sn，請確認網址或直接輸入數字 sn！');
		return;
	}
	manualData['sn'] = snMatch[1];
	manualData['mode'] = $('#manual_mode').val();
	manualData['resolution'] = $('#manual_resolution').val().replace('P', '');
	manualData['classify'] = $('#manual_classify').is(':checked');
	manualData['thread'] = $('#manual_thread_limit').val();
	manualData['danmu'] = $('#manual_danmu').is(':checked');

	// 送出前先鎖按鈕；成功才清空網址，失敗則保留網址並允許重試
	$btn.prop('disabled', true)
		.removeClass('btn-danger')
		.addClass('btn-success')
		.text('提交中…');

	$.ajax({
		url: '/manualTask',
		type: 'post',
		dataType: 'json',
		timeout: 8000,
		headers: {
			'Content-Type': 'application/json;charset=utf-8'
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify(manualData),
		success: function() {
			$('#manual_link').val('').focus();
			flashManualSubmitOk();
			if (window.refreshTaskMonitor) {
				window.refreshTaskMonitor();
			}
		},
		error: function() {
			markManualSubmitFailed();
		}
	});
}

$(function () {
	$('#manualTasks').on('show.bs.modal', initManualTaskModal);
	if (window.location.hash === '#manualTasks') {
		$('#manualTasks').modal('show');
	}
});

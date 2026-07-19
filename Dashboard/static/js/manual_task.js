var manualTaskInited = false;

function initManualTaskModal() {
	if (!manualTaskInited) {
		$('#manual_classify, #manual_danmu').bootstrapSwitch();
		$('#manual_mode, #manual_resolution').selectpicker();
		manualTaskInited = true;
	}

	$.getJSON('data/config.json', function(data) {
		$('#manual_thread_limit').val(data['multi-thread']);
	});
}

function readManualConfig() {
	var manualData = {};
	var link = $('#manual_link').val();
	if (link.length == 0) {
		alert('請輸入影片連結！');
		return;
	}

	manualData['sn'] = link.replace(/(https:\/\/)?ani\.gamer\.com\.tw\/animeVideo\.php\?sn=/i, '');
	manualData['mode'] = $('#manual_mode').val();
	manualData['resolution'] = $('#manual_resolution').val().replace('P', '');
	manualData['classify'] = $('#manual_classify').is(':checked');
	manualData['thread'] = $('#manual_thread_limit').val();
	manualData['danmu'] = $('#manual_danmu').is(':checked');

	$.ajax({
		url: '/manualTask',
		type: 'post',
		dataType: 'json',
		headers: {
			'Content-Type': 'application/json;charset=utf-8'
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify(manualData),
		success: function(data) {
			$('#uploadOk').show();
			$('#uploadFailed').hide();
			$('#uploadStatus').modal();
			$('#manualTasks').modal('hide');
		},
		error: function(status) {
			$('#uploadOk').hide();
			$('#uploadFailed').show();
			$('#uploadStatus').modal();
		}
	});
}

$(function () {
	$('#manualTasks').on('show.bs.modal', initManualTaskModal);
	if (window.location.hash === '#manualTasks') {
		$('#manualTasks').modal('show');
	}
});

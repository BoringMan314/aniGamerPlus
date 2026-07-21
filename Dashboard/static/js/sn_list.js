function showSnList() {
	$.get('data/sn_list', function(data) {
		$('#sn_list').val(data);
	});
}

function postSnList() {
	var sn_list = $('#sn_list').val();

	$.ajax({
		url: '/sn_list',
		type: 'post',
		dataType: 'text',
		headers: {
			'Content-Type': 'text/plain; charset=utf-8'
		},
		contentType: 'text/plain; charset=utf-8',
		data: sn_list,
		success: function(data) {
			showUploadSuccess();
			showSnList();
		},
		error: function(status) {
			showUploadFailure();
		}
	});
}

$(function () {
	showSnList();
	$('#snList').on('show.bs.modal', showSnList);
	if (window.location.hash === '#snList') {
		$('#snList').modal('show');
	}
});

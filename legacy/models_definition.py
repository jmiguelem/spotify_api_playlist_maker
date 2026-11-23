from main import db

class albumGenres(db.Model):
    album_id = db.Column(db.Str)
import requests
import urllib.parse
import json
import pandas as pd
import dotenv
import os

from datetime import datetime, timedelta
from flask import Flask, redirect, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy

# App Configurations
app = Flask(__name__)
app.secret_key = 'a123-b234-c456'

# API Configurations
CLIENT_ID = os.getenv('CLIENT_ID')
CLIENT_SECRET = os.getenv('CLIENT_SECRET')
REDIRECT_URI = 'http://localhost:5000/callback'
AUTH_URL = 'https://accounts.spotify.com/authorize'
TOKEN_URL = 'https://accounts.spotify.com/api/token'
API_BASE_URL = 'https://api.spotify.com/v1/'

# DB Configurations
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///database.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

from db_models import albumGenres

db.create_all()

# Temporal Cache Dictionaries
album_genre_cache = {}
artist_genre_cache = {}

# API Functions
# Function to get the request headers(Authorization Token)
def get_headers():
    return {
        'Authorization': f"Bearer {session['access_token']}"
    }

# Function to check if token is still active
def check_token():
    if 'access_token' not in session:  # If we dont have token, redirect to login
        return redirect('/login')

    if datetime.now().timestamp() > session['expires_at']:
        return redirect('/refresh-token')
    
    return

# Function to get all tracks from a user
def get_all_tracks(offset, limit, params, first_time=True, total_tracks=999999999):
    tracks = []
    headers = get_headers()

    while offset <= total_tracks:
        response = requests.get(API_BASE_URL + 'me/tracks', headers=headers, params=params)
        response_data = response.json()

        tracks += slice_columns(response_data)

        if first_time:
            total_tracks = response_data["total"] - limit
            first_time = False
        
        offset = offset + limit
        params['offset'] = offset
        app.logger.info(offset)
    
    return tracks

# Helper function to get the genre of a songs based on the album and the artists (OLD)
def get_track_genre(album_id, artists_id):
    global album_genre_cache
    global artist_genre_cache
    app.logger.info(album_id)
    headers = get_headers()

    if album_id in album_genre_cache:
        return album_genre_cache[album_id]

    response = requests.get(API_BASE_URL + f'albums/{album_id}', headers=headers)
    response_data = response.json()
    genres = response_data['genres']

    if not genres:
        app.logger.info(artists_id)
        for artist_id in artists_id:
            if artist_id in artist_genre_cache:
                return artist_genre_cache[album_id]
            response = requests.get(API_BASE_URL + f'artists/{artist_id}', headers=headers)
            response_data = response.json()
            genres = genres + response_data['genres']
            artist_genre_cache[artist_id] = genres
    album_genre_cache[album_id] = genres
    return genres

# Function to get the user id
def get_user_id():
    check_token()
    headers = get_headers()
    response = requests.get(API_BASE_URL, headers=headers)
    response_data = response.json()
    id = response_data['id']
    return id

# Logic Functions
# Helper Function to clean the response with only the necessary columns
def slice_columns(response):
    tracks_dict_list = []
    tracks_items = response['items']
    [tracks_dict_list.append(get_track_atributes(item)) for item in tracks_items]
    return tracks_dict_list

# Helper function to get the necesary attributes of a song
def get_track_atributes(items):
    flat_file = {}

    track = items['track']
    album = track['album']
    artists = track['artists']

    flat_file['album_id'] = album['id']
    flat_file['artists_id'] = [artist['id'] for artist in track['artists']]
    flat_file['track_name'] = track['name']
    flat_file['track_id'] = track['id']

    return flat_file



# Home Page
@app.route('/')
def index():
    return "Welcome to my Spotify App <a href='/login'> Login with Spotify</a>"


# End Point: Redirect to Spotify login page 
#   make a request with users credentials and get the token
@app.route('/login')
def login():
    scope = 'user-read-private user-read-email user-library-read'   # Store scopes to access the API
    params = {
        'client_id': CLIENT_ID,
        'response_type': 'code',
        'scope': scope,
        'redirect_uri': REDIRECT_URI,
        'show_dialog': True
    }

    # Make a get request to the AUTH URL with the params dictionary encoded
    auth_url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"
    
    return redirect(auth_url)

# Endpoint: Create the callback that Spotify is going to redirect
@app.route('/callback')
def callback():
    if 'error' in request.args:
        return jsonify({"error": request.args['error']})
    
    if 'code' in request.args:
        req_body = {
            'code': request.args['code'],
            'grant_type': 'authorization_code',
            'redirect_uri': REDIRECT_URI,
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET
        }

        response = requests.post(TOKEN_URL, data=req_body)  # Make request with user credentials
        token_info = response.json()

        session['access_token'] = token_info['access_token']
        session['refresh_token'] = token_info['refresh_token']
        session['expires_at'] = datetime.now().timestamp() + token_info['expires_in']

        return redirect('/menu')

# Endpoint: Display the availabale app options
@app.route('/menu')
def options_menu():
    return "What would you like to do? <br>\
            <a href='/playlists'>  Get playlists</a> <br>\
            <a href='/liked-songs'> Get songs</a><br>\
            <a href='/playlist-gender'> Get playlist for gender</a><br>"

# Endpoint: Retrieve users playlists
@app.route('/playlists')
def get_playlists():
    check_token()

    headers = get_headers()


    response = requests.get(API_BASE_URL + 'me/playlists', headers=headers)
    playlists = response.json()

    return jsonify(playlists)

# Endpoint: Refresh access token
@app.route('/refresh-token')
def refresh_token():
    if 'refresh_token' not in session:
        return redirect('/login')
    
    if datetime.now().timestamp() > session['expires_at']:
        req_body = {
            'grant_type': 'refresh_token',
            'refresh_token': session['refresh_token'],
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET
        }

        response = requests.post(TOKEN_URL, data=req_body)
        new_token_info = response.json()

        session['access_token'] = new_token_info['access_token']
        session['expires_at'] = datetime.now().timestamp() + new_token_info['expires_in']

        return redirect('/playlists')

# Endpoint: Gett user liked songs
@app.route('/liked-songs')
def get_liked_songs():
    check_token()

    offset = 0
    limit = 50
    params = {
        'limit': limit,
        'offset': offset
    }

    tracks_data = get_all_tracks(offset, limit, params)
    #with open('songs.json', 'w') as f:
        #json.dump(response_data, f)
    
    songs_data = pd.DataFrame(tracks_data)
    songs_data = songs_data.explode('artists_id')
    songs_data = songs_data.sort_values(['album_id', 'artists_id'])
    
    user_id = get_user_id()
    songs_data['id'] = user_id
    songs_data.to_csv('data.csv', index=False)
    #songs_data['genres'] = songs_data.apply(lambda row: get_track_genre(row['album_id'], row['artists_id']), axis=1)
    #genres = get_track_genre(album_id, artists_id)
    #songs_data.to_csv('data.csv', index=False)

    #tracks_genre = songs_data[['track_id', 'genres']]
    #tracks_genre = tracks_genre.explode('genres')
    #tracks_genre.to_csv('tracks_genre.csv', index=False)
    return 'success'

# Endpoint: Create playlists by users songs genres
@app.route('/playlist-gender')
def create_playlist_by_gender():
    check_token()
    
    songs = pd.read_csv('data.csv')
    # TRY getting by albums
    unique_albums = songs['album_id'].unique()
    app.logger.info(len(unique_albums))

    unique_artists = songs['artists_id'].unique()
    app.logger.info(len(unique_artists))
    return "ok"

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)